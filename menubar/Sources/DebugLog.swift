import Foundation

enum DebugLog {
    private static let path = NSHomeDirectory() + "/Library/Logs/gemini-menubar-debug.log"
    private static let lock = NSLock()
    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f
    }()

    static func write(_ msg: String) {
        let ts = dateFormatter.string(from: Date())
        let line = "\(ts) \(msg)\n"
        lock.lock()
        defer { lock.unlock() }
        if let data = line.data(using: .utf8) {
            if let fh = FileHandle(forWritingAtPath: path) {
                fh.seekToEndOfFile()
                fh.write(data)
                fh.closeFile()
            } else {
                FileManager.default.createFile(atPath: path, contents: data)
            }
        }
    }
}
