import SwiftUI
import Charts
import AppKit

// MARK: - MenuHostingView

final class MenuHostingView<Content: View>: NSHostingView<Content> {
    override var allowsVibrancy: Bool { true }
}

// MARK: - Status Card

struct StatusCardView: View {
    let isRunning: Bool
    let statusText: String
    let version: String
    let uptime: String
    let authMethod: String

    var statusColor: Color {
        isRunning ? .green : .red
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 8, height: 8)
                Text(statusText)
                    .font(.body)
                    .fontWeight(.semibold)
            }
            HStack(spacing: 0) {
                Text("\(version) \u{00B7} Up \(uptime) \u{00B7} ")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Text(authMethod)
                    .font(.footnote)
                    .foregroundStyle(authMethod == "Not signed in" ? .orange : .secondary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(width: 280, alignment: .leading)
    }
}

// MARK: - Stats Card

struct ModelStat: Identifiable {
    let id = UUID()
    let name: String
    let count: Int

    var color: Color {
        switch name {
        case let n where n.contains("2.5-pro"):  return .blue
        case let n where n.contains("2.5-flash"): return .green
        case let n where n.contains("2.0-flash"): return .orange
        case let n where n.contains("3-pro"):    return .cyan
        case let n where n.contains("3-flash"):  return .mint
        default: return .gray
        }
    }
}

struct StatsCardView: View {
    let stats: [ModelStat]

    private var totalRequests: Int { stats.reduce(0) { $0 + $1.count } }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Requests")
                    .font(.headline)
                    .fontWeight(.semibold)
                Spacer()
                if !stats.isEmpty {
                    Text("\(totalRequests) total")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            if stats.isEmpty {
                HStack {
                    Spacer()
                    Text("No requests yet")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(.vertical, 8)
            } else {
                Chart(stats) { model in
                    BarMark(
                        x: .value("Requests", model.count),
                        y: .value("Model", model.name)
                    )
                    .foregroundStyle(model.color)
                    .annotation(position: .trailing, spacing: 4) {
                        Text("\(model.count)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .chartXAxis(.hidden)
                .chartLegend(.hidden)
                .frame(height: max(CGFloat(stats.count) * 28, 60))

                // Capsule progress bar showing relative usage
                if stats.count > 1 {
                    GeometryReader { geo in
                        HStack(spacing: 1) {
                            ForEach(stats) { model in
                                let fraction = CGFloat(model.count) / CGFloat(totalRequests)
                                RoundedRectangle(cornerRadius: 3)
                                    .fill(model.color)
                                    .frame(width: max(fraction * geo.size.width, 2))
                            }
                        }
                    }
                    .frame(height: 6)
                    .clipShape(Capsule())
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(width: 280, alignment: .leading)
    }
}

// MARK: - Quota Card

struct QuotaCardView: View {
    let quotas: [QuotaInfo]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Model Quota")
                .font(.headline)
                .fontWeight(.semibold)

            if quotas.isEmpty {
                HStack {
                    Spacer()
                    Text("No quota data")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(.vertical, 8)
            } else {
                ForEach(quotas, id: \.modelId) { quota in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(quota.modelId)
                                .font(.caption)
                                .lineLimit(1)
                            Spacer()
                            Text("\(quota.percentLeft)%")
                                .font(.caption)
                                .fontWeight(.medium)
                                .foregroundStyle(quotaColor(quota.percentLeft))
                        }
                        HStack(spacing: 6) {
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    Capsule()
                                        .fill(Color.primary.opacity(0.1))
                                        .frame(height: 6)
                                    Capsule()
                                        .fill(quotaColor(quota.percentLeft))
                                        .frame(width: max(CGFloat(quota.percentLeft) / 100.0 * geo.size.width, 2), height: 6)
                                }
                            }
                            .frame(height: 6)
                            Text(quota.resetDescription)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .fixedSize()
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(width: 280, alignment: .leading)
    }

    private func quotaColor(_ percent: Int) -> Color {
        if percent > 50 { return .green }
        if percent > 20 { return .orange }
        return .red
    }
}

// MARK: - Helper to create hosted menu items

func makeHostedMenuItem<V: View>(view: V) -> NSMenuItem {
    let hostingView = MenuHostingView(rootView: view)
    hostingView.frame.size = hostingView.fittingSize
    let item = NSMenuItem()
    item.view = hostingView
    return item
}
