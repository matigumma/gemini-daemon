import Foundation

struct ChatMessage {
    enum Role: String {
        case user
        case assistant
    }
    let role: Role
    let content: String
}

final class StreamingClient: NSObject, URLSessionDataDelegate {
    private let endpoint = URL(string: "http://127.0.0.1:7965/v1/chat/completions")!
    private var session: URLSession!
    private var task: URLSessionDataTask?
    private var buffer = Data()
    private var completed = false
    private var currentAssistantResponse = ""

    private(set) var messages: [ChatMessage] = []

    var onToken: ((String) -> Void)?
    var onComplete: (() -> Void)?
    var onError: ((String) -> Void)?

    override init() {
        super.init()
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 120
        config.timeoutIntervalForResource = 300
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    func send(prompt: String) {
        cancel()
        buffer = Data()
        completed = false
        currentAssistantResponse = ""

        messages.append(ChatMessage(role: .user, content: prompt))

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let messagesPayload = messages.map { msg -> [String: String] in
            ["role": msg.role.rawValue, "content": msg.content]
        }

        let body: [String: Any] = [
            "model": "gemini-2.5-flash",
            "stream": true,
            "messages": messagesPayload
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        log("[send] url=\(endpoint) historyCount=\(messages.count)")

        task = session.dataTask(with: request)
        task?.resume()
    }

    func cancel() {
        if task != nil { log("[cancel] cancelling active task") }
        task?.cancel()
        task = nil
    }

    func clearHistory() {
        messages.removeAll()
        currentAssistantResponse = ""
    }

    // MARK: - URLSessionDataDelegate

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        log("[response] HTTP \(status)")
        if status >= 400 {
            let msg = "HTTP \(status)"
            DispatchQueue.main.async { self.onError?(msg) }
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        log("[data] received \(data.count) bytes")
        buffer.append(data)
        processBuffer()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error as NSError?, error.domain == NSURLErrorDomain, error.code == NSURLErrorCancelled {
            log("[complete] cancelled (intentional)")
            return
        }
        if let error {
            log("[complete] error: \(error.localizedDescription)")
            DispatchQueue.main.async { self.onError?(error.localizedDescription) }
            return
        }
        log("[complete] success")
        finishStream()
    }

    // MARK: - SSE Parsing

    private func processBuffer() {
        guard let text = String(data: buffer, encoding: .utf8) else {
            log("[parse] buffer not valid UTF-8, \(buffer.count) bytes")
            return
        }

        var remaining = ""
        let lines = text.components(separatedBy: "\n")

        for (i, line) in lines.enumerated() {
            if i == lines.count - 1 && !text.hasSuffix("\n") {
                remaining = line
                break
            }

            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("data: ") else { continue }
            let payload = String(trimmed.dropFirst(6))

            if payload == "[DONE]" {
                log("[parse] got [DONE]")
                finishStream()
                return
            }

            guard let jsonData = payload.data(using: .utf8) else {
                log("[parse] payload not valid UTF-8")
                continue
            }

            guard let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
                log("[parse] invalid JSON chunk")
                continue
            }

            guard let choices = json["choices"] as? [[String: Any]] else {
                log("[parse] no choices in chunk")
                continue
            }

            guard let delta = choices.first?["delta"] as? [String: Any] else {
                log("[parse] no delta in choices")
                continue
            }

            guard let content = delta["content"] as? String else {
                log("[parse] no content in delta")
                continue
            }

            currentAssistantResponse += content
            log("[parse] token received")
            DispatchQueue.main.async { self.onToken?(content) }
        }

        buffer = remaining.data(using: .utf8) ?? Data()
    }

    private func finishStream() {
        guard !completed else { return }
        completed = true

        if !currentAssistantResponse.isEmpty {
            messages.append(ChatMessage(role: .assistant, content: currentAssistantResponse))
        }

        DispatchQueue.main.async { self.onComplete?() }
    }

    private func log(_ msg: String) {
        DebugLog.write("[StreamingClient] \(msg)")
    }
}
