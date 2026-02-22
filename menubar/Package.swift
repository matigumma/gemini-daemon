// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "GeminiDaemonMenuBar",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "GeminiDaemonMenuBar", path: "Sources")
    ]
)
