import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var statusItem: NSStatusItem!
    private let monitor = DaemonMonitor()

    private var statusCardItem: NSMenuItem!
    private var statsCardItem: NSMenuItem!
    private var quotaCardItem: NSMenuItem!
    private var toggleMenuItem: NSMenuItem!
    private var restartMenuItem: NSMenuItem!
    private var installMenuItem: NSMenuItem!
    private var registerOpenClawMenuItem: NSMenuItem!
    private lazy var promptPanel = PromptPanel()

    // SwiftUI state for menu cards
    private var statusIsRunning = false
    private var statusText = "Checking..."
    private var statusVersion = "v?"
    private var statusUptime = "—"
    private var statusAuth = "—"
    private var currentStats: [ModelStat] = []
    private var currentQuotas: [QuotaInfo] = []
    private var lastQuotaFetch: Date = .distantPast

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem.button {
            button.attributedTitle = statusBarTitle(statusColor: .systemGray)
        }

        buildMenu()

        monitor.onStatusChange = { [weak self] status in
            self?.handleStatusChange(status)
        }
        monitor.startPolling()
    }

    private func statusBarTitle(statusColor: NSColor) -> NSAttributedString {
        let result = NSMutableAttributedString()

        // Frog emoji
        let frog = NSAttributedString(string: "\u{1F438} ", attributes: [
            .font: NSFont.systemFont(ofSize: 14),
        ])
        result.append(frog)

        // Colored status dot
        let dot = NSAttributedString(string: "\u{25CF}", attributes: [
            .font: NSFont.systemFont(ofSize: 6),
            .foregroundColor: statusColor,
            .baselineOffset: 2,
        ])
        result.append(dot)

        return result
    }

    // MARK: - Menu

    private func buildMenu() {
        let menu = NSMenu()
        menu.delegate = self

        // Status card (SwiftUI hosted)
        statusCardItem = makeHostedMenuItem(view: StatusCardView(
            isRunning: false, statusText: "Checking...",
            version: "v?", uptime: "—", authMethod: "—"
        ))
        menu.addItem(statusCardItem)

        toggleMenuItem = NSMenuItem(title: "Start Daemon", action: #selector(toggleDaemon), keyEquivalent: "")
        toggleMenuItem.target = self
        menu.addItem(toggleMenuItem)

        restartMenuItem = NSMenuItem(title: "Restart Daemon", action: #selector(restartDaemon), keyEquivalent: "r")
        restartMenuItem.target = self
        restartMenuItem.isHidden = true
        menu.addItem(restartMenuItem)

        menu.addItem(.separator())

        // Stats card (SwiftUI hosted)
        statsCardItem = makeHostedMenuItem(view: StatsCardView(stats: []))
        menu.addItem(statsCardItem)

        // Quota card (SwiftUI hosted)
        quotaCardItem = makeHostedMenuItem(view: QuotaCardView(quotas: []))
        menu.addItem(quotaCardItem)

        menu.addItem(.separator())

        let promptItem = NSMenuItem(title: "Quick Prompt...", action: #selector(openPrompt), keyEquivalent: "p")
        promptItem.target = self
        menu.addItem(promptItem)

        menu.addItem(.separator())

        let logsItem = NSMenuItem(title: "Open Logs...", action: #selector(openLogs), keyEquivalent: "l")
        logsItem.target = self
        menu.addItem(logsItem)

        let errorLogItem = NSMenuItem(title: "Open Error Log...", action: #selector(openErrorLog), keyEquivalent: "e")
        errorLogItem.target = self
        menu.addItem(errorLogItem)

        menu.addItem(.separator())

        registerOpenClawMenuItem = NSMenuItem(title: "Register on OpenClaw...", action: #selector(registerOnOpenClaw), keyEquivalent: "")
        registerOpenClawMenuItem.target = self
        registerOpenClawMenuItem.isHidden = openclawConfigured
        menu.addItem(registerOpenClawMenuItem)

        installMenuItem = NSMenuItem(title: "Install LaunchAgent...", action: #selector(installService), keyEquivalent: "")
        installMenuItem.target = self
        installMenuItem.isHidden = monitor.plistExists
        menu.addItem(installMenuItem)

        if !monitor.plistExists || !openclawConfigured {
            menu.addItem(.separator())
        }

        let quitItem = NSMenuItem(title: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quitItem)

        statusItem.menu = menu
    }

    // MARK: - NSMenuDelegate

    func menuWillOpen(_ menu: NSMenu) {
        refreshStats()
        refreshQuota()
    }

    private func refreshStats() {
        monitor.fetchStats { [weak self] stats in
            DispatchQueue.main.async {
                guard let self else { return }
                self.currentStats = stats
                    .map { ModelStat(name: $0.key, count: $0.value) }
                    .sorted { $0.count > $1.count }
                self.updateStatsCard()
            }
        }
    }

    private func refreshQuota() {
        guard Date().timeIntervalSince(lastQuotaFetch) >= 60 else { return }
        lastQuotaFetch = Date()
        monitor.fetchQuota { [weak self] quotas in
            DispatchQueue.main.async {
                guard let self else { return }
                self.currentQuotas = quotas
                self.updateQuotaCard()
            }
        }
    }

    private func updateQuotaCard() {
        let view = QuotaCardView(quotas: currentQuotas)
        let hostingView = MenuHostingView(rootView: view)
        hostingView.frame.size = hostingView.fittingSize
        quotaCardItem.view = hostingView
    }

    private func updateStatusCard() {
        let view = StatusCardView(
            isRunning: statusIsRunning,
            statusText: statusText,
            version: statusVersion,
            uptime: statusUptime,
            authMethod: statusAuth
        )
        let hostingView = MenuHostingView(rootView: view)
        hostingView.frame.size = hostingView.fittingSize
        statusCardItem.view = hostingView
    }

    private func updateStatsCard() {
        let view = StatsCardView(stats: currentStats)
        let hostingView = MenuHostingView(rootView: view)
        hostingView.frame.size = hostingView.fittingSize
        statsCardItem.view = hostingView
    }

    // MARK: - Status

    private func handleStatusChange(_ status: DaemonStatus) {
        guard let button = statusItem.button else { return }

        switch status {
        case let .running(uptime, authMethod, version):
            button.attributedTitle = statusBarTitle(statusColor: .systemGreen)
            statusIsRunning = true
            statusText = "Running"
            statusVersion = "v\(version)"
            statusUptime = formatUptime(uptime)
            statusAuth = authMethod
            toggleMenuItem.title = "Stop Daemon"
            toggleMenuItem.action = #selector(toggleDaemon)
            restartMenuItem.isHidden = false

        case .stopped:
            button.attributedTitle = statusBarTitle(statusColor: .systemRed)
            statusIsRunning = false
            statusText = "Stopped"
            statusVersion = "—"
            statusUptime = "—"
            statusAuth = "—"
            toggleMenuItem.title = "Start Daemon"
            toggleMenuItem.action = monitor.plistExists ? #selector(toggleDaemon) : nil
            restartMenuItem.isHidden = true

        case let .error(message):
            button.attributedTitle = statusBarTitle(statusColor: .systemYellow)
            statusIsRunning = false
            statusText = "Error: \(message)"
            statusVersion = "—"
            statusUptime = "—"
            statusAuth = "—"
            toggleMenuItem.title = "Stop Daemon"
            toggleMenuItem.action = #selector(toggleDaemon)
            restartMenuItem.isHidden = false

        case .unknown:
            button.attributedTitle = statusBarTitle(statusColor: .systemGray)
            statusIsRunning = false
            statusText = "Checking..."
            statusVersion = "v?"
            statusUptime = "—"
            statusAuth = "—"
            toggleMenuItem.title = "Start Daemon"
            toggleMenuItem.action = nil
            restartMenuItem.isHidden = true
        }

        updateStatusCard()
        installMenuItem.isHidden = monitor.plistExists
    }

    // MARK: - Actions

    @objc private func toggleDaemon() {
        switch monitor.lastStatus {
        case .running, .error:
            monitor.stopDaemon()
        case .stopped:
            monitor.startDaemon()
        default:
            break
        }

        // Poll sooner to pick up the change
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            self?.monitor.checkHealth()
        }
    }

    @objc private func restartDaemon() {
        monitor.restartDaemon()
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            self?.monitor.checkHealth()
        }
    }

    @objc private func openLogs() {
        let path = NSHomeDirectory() + "/Library/Logs/gemini-daemon.out.log"
        NSWorkspace.shared.open(URL(fileURLWithPath: path))
    }

    @objc private func openErrorLog() {
        let path = NSHomeDirectory() + "/Library/Logs/gemini-daemon.err.log"
        NSWorkspace.shared.open(URL(fileURLWithPath: path))
    }

    @objc private func installService() {
        monitor.installService()
        // Refresh menu after a short delay to update install item visibility
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            self?.installMenuItem.isHidden = self?.monitor.plistExists ?? true
        }
    }

    @objc private func openPrompt() {
        promptPanel.show()
    }

    // MARK: - OpenClaw Registration

    private var openclawConfigPath: String {
        NSHomeDirectory() + "/.openclaw/openclaw.json"
    }

    private var openclawConfigured: Bool {
        guard let data = FileManager.default.contents(atPath: openclawConfigPath),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let models = json["models"] as? [String: Any],
              let providers = models["providers"] as? [String: Any] else {
            return false
        }
        return providers["gemini-daemon"] != nil
    }

    @objc private func registerOnOpenClaw() {
        let path = openclawConfigPath

        guard FileManager.default.fileExists(atPath: path) else {
            showAlert(title: "OpenClaw config not found",
                      message: "Run `openclaw configure` first to create ~/.openclaw/openclaw.json.")
            return
        }

        guard let data = FileManager.default.contents(atPath: path),
              let root = try? JSONSerialization.jsonObject(with: data, options: .mutableContainers) as? NSMutableDictionary else {
            showAlert(title: "Error", message: "Failed to parse openclaw.json.")
            return
        }

        // Ensure models.providers exists
        if root["models"] == nil { root["models"] = NSMutableDictionary() }
        let models = root["models"] as! NSMutableDictionary
        if models["providers"] == nil { models["providers"] = NSMutableDictionary() }
        let providers = models["providers"] as! NSMutableDictionary

        // Add gemini-daemon provider
        providers["gemini-daemon"] = [
            "baseUrl": "http://127.0.0.1:7965/v1",
            "apiKey": "none",
            "api": "openai-completions",
            "models": [
                ["id": "gemini-2.5-pro", "name": "Gemini 2.5 Pro (local)", "contextWindow": 1000000, "maxTokens": 65536],
                ["id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash (local)", "contextWindow": 1000000, "maxTokens": 65536],
                ["id": "gemini-2.0-flash", "name": "Gemini 2.0 Flash (local)", "contextWindow": 1000000, "maxTokens": 8192],
            ]
        ] as [String: Any]

        // Ensure agents.defaults.models exists
        if root["agents"] == nil { root["agents"] = NSMutableDictionary() }
        let agents = root["agents"] as! NSMutableDictionary
        if agents["defaults"] == nil { agents["defaults"] = NSMutableDictionary() }
        let defaults = agents["defaults"] as! NSMutableDictionary
        if defaults["models"] == nil { defaults["models"] = NSMutableDictionary() }
        let modelDefaults = defaults["models"] as! NSMutableDictionary

        // Add model entries if not present
        if modelDefaults["gemini-daemon/gemini-2.5-pro"] == nil {
            modelDefaults["gemini-daemon/gemini-2.5-pro"] = NSDictionary()
        }
        if modelDefaults["gemini-daemon/gemini-2.5-flash"] == nil {
            modelDefaults["gemini-daemon/gemini-2.5-flash"] = ["alias": "gflash"]
        }
        if modelDefaults["gemini-daemon/gemini-2.0-flash"] == nil {
            modelDefaults["gemini-daemon/gemini-2.0-flash"] = NSDictionary()
        }

        // Write back
        do {
            let output = try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted])
            try output.write(to: URL(fileURLWithPath: path))
        } catch {
            showAlert(title: "Error", message: "Failed to write openclaw.json: \(error.localizedDescription)")
            return
        }

        registerOpenClawMenuItem.isHidden = true
        showAlert(title: "Registered",
                  message: "Registered gemini-daemon on OpenClaw. Restart OpenClaw to pick up changes.")
    }

    private func showAlert(title: String, message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    private func formatUptime(_ seconds: Int) -> String {
        if seconds < 60 {
            return "\(seconds)s"
        } else if seconds < 3600 {
            return "\(seconds / 60)m"
        } else {
            let hours = seconds / 3600
            let minutes = (seconds % 3600) / 60
            return minutes > 0 ? "\(hours)h \(minutes)m" : "\(hours)h"
        }
    }
}
