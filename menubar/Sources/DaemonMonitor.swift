import Foundation

struct QuotaInfo {
    let modelId: String
    let percentLeft: Int
    let resetTime: String?
    let resetDescription: String
}

enum DaemonStatus: Equatable {
    case running(uptime: Int, authMethod: String, version: String, authenticated: Bool)
    case stopped
    case error(String)
    case unknown

    static func == (lhs: DaemonStatus, rhs: DaemonStatus) -> Bool {
        switch (lhs, rhs) {
        case let (.running(u1, a1, v1, auth1), .running(u2, a2, v2, auth2)):
            return u1 == u2 && a1 == a2 && v1 == v2 && auth1 == auth2
        case (.stopped, .stopped): return true
        case let (.error(e1), .error(e2)): return e1 == e2
        case (.unknown, .unknown): return true
        default: return false
        }
    }
}

final class DaemonMonitor {
    private let healthURL = URL(string: "http://127.0.0.1:7965/health")!
    private let plistPath: String
    private let session: URLSession
    private var timer: Timer?

    var onStatusChange: ((DaemonStatus) -> Void)?
    private(set) var lastStatus: DaemonStatus = .unknown

    var plistExists: Bool {
        FileManager.default.fileExists(atPath: plistPath)
    }

    init() {
        self.plistPath = NSHomeDirectory() + "/Library/LaunchAgents/com.gemini-daemon.plist"
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 3
        config.timeoutIntervalForResource = 3
        self.session = URLSession(configuration: config)
    }

    func startPolling() {
        checkHealth()
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.checkHealth()
        }
    }

    func stopPolling() {
        timer?.invalidate()
        timer = nil
    }

    func checkHealth() {
        let task = session.dataTask(with: healthURL) { [weak self] data, response, error in
            guard let self else { return }

            let status: DaemonStatus

            if let error = error as? URLError {
                if error.code == .cannotConnectToHost || error.code == .timedOut || error.code == .networkConnectionLost {
                    status = .stopped
                } else {
                    status = .error(error.localizedDescription)
                }
            } else if let error {
                status = .error(error.localizedDescription)
            } else if let data,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let healthStatus = json["status"] as? String {
                if healthStatus == "ok" {
                    let uptime = json["uptime"] as? Int ?? 0
                    let authMethod = json["auth_method"] as? String ?? "unknown"
                    let version = json["version"] as? String ?? "?"
                    let authenticated = json["authenticated"] as? Bool ?? false
                    status = .running(uptime: uptime, authMethod: authMethod, version: version, authenticated: authenticated)
                } else {
                    status = .error("Health status: \(healthStatus)")
                }
            } else {
                status = .error("Invalid health response")
            }

            DispatchQueue.main.async {
                self.lastStatus = status
                self.onStatusChange?(status)
            }
        }
        task.resume()
    }

    func startDaemon() {
        runLaunchctl(["load", plistPath])
    }

    func stopDaemon() {
        runLaunchctl(["unload", plistPath])
    }

    func restartDaemon() {
        runLaunchctl(["unload", plistPath])
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [self] in
            runLaunchctl(["load", plistPath])
        }
    }

    func installService() {
        let scriptPath = NSHomeDirectory() + "/gemini-daemon/daemon/install-service.sh"

        guard FileManager.default.fileExists(atPath: scriptPath) else {
            DebugLog.write("[DaemonMonitor] install script not found at \(scriptPath)")
            return
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [scriptPath]
        process.currentDirectoryURL = URL(fileURLWithPath: NSHomeDirectory() + "/gemini-daemon/daemon")

        do {
            try process.run()
        } catch {
            DebugLog.write("[DaemonMonitor] failed to run install script: \(error.localizedDescription)")
        }
    }

    func startAuthFlow(completion: @escaping (URL?) -> Void) {
        let authStartURL = URL(string: "http://127.0.0.1:7965/auth/start")!
        let task = session.dataTask(with: authStartURL) { data, _, error in
            guard let data, error == nil,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let authUrlString = json["auth_url"] as? String,
                  let authUrl = URL(string: authUrlString) else {
                completion(nil)
                return
            }
            completion(authUrl)
        }
        task.resume()
    }

    func fetchQuota(completion: @escaping ([QuotaInfo]) -> Void) {
        let quotaURL = URL(string: "http://127.0.0.1:7965/quota")!
        let task = session.dataTask(with: quotaURL) { data, _, error in
            guard let data, error == nil,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let quotas = json["quotas"] as? [[String: Any]] else {
                completion([])
                return
            }
            let parsed = quotas.compactMap { q -> QuotaInfo? in
                guard let modelId = q["modelId"] as? String,
                      let percentLeft = q["percentLeft"] as? Int else { return nil }
                let resetTime = q["resetTime"] as? String
                let resetDescription = q["resetDescription"] as? String ?? "—"
                return QuotaInfo(modelId: modelId, percentLeft: percentLeft,
                                 resetTime: resetTime, resetDescription: resetDescription)
            }
            completion(parsed)
        }
        task.resume()
    }

    func fetchStats(completion: @escaping ([String: Int]) -> Void) {
        let statsURL = URL(string: "http://127.0.0.1:7965/stats")!
        let task = session.dataTask(with: statsURL) { data, _, error in
            guard let data, error == nil,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let requestsByModel = json["requests_by_model"] as? [String: Int] else {
                completion([:])
                return
            }
            completion(requestsByModel)
        }
        task.resume()
    }

    private func runLaunchctl(_ arguments: [String]) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = arguments
        do {
            try process.run()
        } catch {
            DebugLog.write("[DaemonMonitor] launchctl \(arguments.joined(separator: " ")) failed: \(error.localizedDescription)")
        }
    }
}
