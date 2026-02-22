import AppKit

final class ChatBubbleView: NSView {
    enum Role {
        case user
        case model
    }

    private let role: Role
    private let textView = NSTextView()
    private let backgroundView = NSView()
    private let maxBubbleWidthFraction: CGFloat = 0.8

    init(role: Role) {
        self.role = role
        super.init(frame: .zero)
        setupViews()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    private func setupViews() {
        translatesAutoresizingMaskIntoConstraints = false

        // Background pill
        backgroundView.wantsLayer = true
        backgroundView.layer?.cornerRadius = 10
        backgroundView.layer?.masksToBounds = true
        backgroundView.translatesAutoresizingMaskIntoConstraints = false

        switch role {
        case .user:
            backgroundView.layer?.backgroundColor = NSColor.systemBlue.withAlphaComponent(0.2).cgColor
        case .model:
            backgroundView.layer?.backgroundColor = NSColor.systemGray.withAlphaComponent(0.15).cgColor
        }

        addSubview(backgroundView)

        // Text view
        textView.isEditable = false
        textView.isSelectable = true
        textView.drawsBackground = false
        textView.font = NSFont.systemFont(ofSize: 13)
        textView.textColor = .labelColor
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.lineFragmentPadding = 4
        textView.textContainerInset = NSSize(width: 4, height: 4)
        textView.translatesAutoresizingMaskIntoConstraints = false

        backgroundView.addSubview(textView)

        // Text fills background
        NSLayoutConstraint.activate([
            textView.topAnchor.constraint(equalTo: backgroundView.topAnchor, constant: 4),
            textView.bottomAnchor.constraint(equalTo: backgroundView.bottomAnchor, constant: -4),
            textView.leadingAnchor.constraint(equalTo: backgroundView.leadingAnchor, constant: 8),
            textView.trailingAnchor.constraint(equalTo: backgroundView.trailingAnchor, constant: -8),
        ])

        // Background inside self — alignment depends on role
        NSLayoutConstraint.activate([
            backgroundView.topAnchor.constraint(equalTo: topAnchor),
            backgroundView.bottomAnchor.constraint(equalTo: bottomAnchor),
            backgroundView.widthAnchor.constraint(lessThanOrEqualTo: widthAnchor, multiplier: maxBubbleWidthFraction),
            backgroundView.widthAnchor.constraint(greaterThanOrEqualToConstant: 40),
        ])

        switch role {
        case .user:
            backgroundView.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -4).isActive = true
        case .model:
            backgroundView.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 4).isActive = true
        }
    }

    // MARK: - Intrinsic Content Size

    override var intrinsicContentSize: NSSize {
        // Use a reasonable default width to compute text height
        let availableWidth = max(bounds.width, 300)
        let bubbleWidth = availableWidth * maxBubbleWidthFraction
        // Inner text width: bubble width minus padding (8 leading + 8 trailing)
        // and text container inset (4+4) and line fragment padding (4+4)
        let textWidth = bubbleWidth - 16 - 8 - 8

        guard let layoutManager = textView.layoutManager,
              let textContainer = textView.textContainer else {
            return NSSize(width: NSView.noIntrinsicMetric, height: 30)
        }

        textContainer.containerSize = NSSize(width: max(textWidth, 20), height: .greatestFiniteMagnitude)
        layoutManager.ensureLayout(for: textContainer)
        let textRect = layoutManager.usedRect(for: textContainer)

        // Total height: text height + textContainerInset (4+4) + background padding (4+4)
        let height = textRect.height + 8 + 8
        return NSSize(width: NSView.noIntrinsicMetric, height: max(height, 24))
    }

    override func layout() {
        super.layout()
        invalidateIntrinsicContentSize()
    }

    // MARK: - Content

    func setText(_ text: String) {
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 13),
            .foregroundColor: NSColor.labelColor,
        ]
        textView.textStorage?.setAttributedString(NSAttributedString(string: text, attributes: attrs))
        invalidateIntrinsicContentSize()
    }

    func appendText(_ text: String) {
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 13),
            .foregroundColor: NSColor.labelColor,
        ]
        textView.textStorage?.append(NSAttributedString(string: text, attributes: attrs))
        invalidateIntrinsicContentSize()
    }
}
