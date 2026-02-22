import AppKit

final class PromptPanel: NSPanel {
    private let inputField = NSTextField()
    private let spinner = NSProgressIndicator()
    private let chatScroll = NSScrollView()
    private let chatStack = NSStackView()
    private let effectView = NSVisualEffectView()
    private let stack = NSStackView()
    private let client = StreamingClient()
    private let closeButton = NSButton()

    private var currentBubble: ChatBubbleView?

    private let panelWidth: CGFloat = 680
    private let minHeight: CGFloat = 60
    private let maxHeight: CGFloat = 520
    private let padding: CGFloat = 8
    private var scrollHeightConstraint: NSLayoutConstraint!

    init() {
        super.init(contentRect: NSRect(x: 0, y: 0, width: 680, height: 60),
                   styleMask: [.titled, .nonactivatingPanel, .fullSizeContentView],
                   backing: .buffered, defer: true)

        titlebarAppearsTransparent = true
        titleVisibility = .hidden
        level = .floating
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = false
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        isMovableByWindowBackground = true

        setupViews()
        setupClient()
    }

    override var canBecomeKey: Bool { true }

    // Intercept Escape before it reaches the text field's field editor
    override func sendEvent(_ event: NSEvent) {
        if event.type == .keyDown && event.keyCode == 53 {
            log("Escape pressed -> dismiss")
            dismiss()
            return
        }
        super.sendEvent(event)
    }

    // MARK: - Public

    func show() {
        log("show()")
        positionOnScreen()
        resetToMinHeight()
        inputField.stringValue = ""

        // Clear chat bubbles and history
        chatStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        client.clearHistory()
        chatScroll.isHidden = true

        spinner.isHidden = true
        spinner.stopAnimation(nil)
        inputField.isEditable = true

        NSApp.activate(ignoringOtherApps: true)
        makeKeyAndOrderFront(nil)
        makeFirstResponder(inputField)
        log("show() done, isVisible=\(isVisible) isKeyWindow=\(isKeyWindow)")
    }

    func dismiss() {
        log("dismiss()")
        client.cancel()
        orderOut(nil)
    }

    // MARK: - Setup

    private func setupViews() {
        effectView.material = .hudWindow
        effectView.blendingMode = .behindWindow
        effectView.state = .active
        effectView.wantsLayer = true
        effectView.layer?.cornerRadius = 12
        effectView.layer?.masksToBounds = true

        // Input field
        inputField.placeholderString = "Ask Gemini..."
        inputField.isBordered = false
        inputField.isBezeled = false
        inputField.drawsBackground = false
        inputField.font = NSFont.systemFont(ofSize: 20)
        inputField.focusRingType = .none
        inputField.target = self
        inputField.action = #selector(inputDidSubmit)
        inputField.translatesAutoresizingMaskIntoConstraints = false
        inputField.heightAnchor.constraint(equalToConstant: 44).isActive = true

        // Spinner
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isHidden = true
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.widthAnchor.constraint(equalToConstant: 18).isActive = true
        spinner.heightAnchor.constraint(equalToConstant: 18).isActive = true

        // Chat stack (vertical stack of bubbles)
        chatStack.orientation = .vertical
        chatStack.alignment = .width
        chatStack.spacing = 8
        chatStack.translatesAutoresizingMaskIntoConstraints = false

        // Chat scroll view
        chatScroll.documentView = chatStack
        chatScroll.hasVerticalScroller = true
        chatScroll.hasHorizontalScroller = false
        chatScroll.drawsBackground = false
        chatScroll.isHidden = true
        chatScroll.translatesAutoresizingMaskIntoConstraints = false

        // Pin chatStack width to the scroll's clip view
        let clipView = chatScroll.contentView
        chatStack.leadingAnchor.constraint(equalTo: clipView.leadingAnchor).isActive = true
        chatStack.trailingAnchor.constraint(equalTo: clipView.trailingAnchor).isActive = true

        // Stack layout
        stack.orientation = .vertical
        stack.alignment = .width
        stack.spacing = 6
        stack.edgeInsets = NSEdgeInsets(top: padding, left: padding + 4, bottom: padding, right: padding + 4)

        stack.addArrangedSubview(inputField)
        stack.addArrangedSubview(spinner)
        stack.addArrangedSubview(chatScroll)

        scrollHeightConstraint = chatScroll.heightAnchor.constraint(equalToConstant: 0)
        scrollHeightConstraint.isActive = true

        effectView.frame = contentView!.bounds
        effectView.autoresizingMask = [.width, .height]
        contentView?.addSubview(effectView)

        stack.translatesAutoresizingMaskIntoConstraints = false
        contentView?.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: contentView!.topAnchor),
            stack.bottomAnchor.constraint(equalTo: contentView!.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: contentView!.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: contentView!.trailingAnchor),
        ])

        // Close button (top-right, outside the stack)
        closeButton.bezelStyle = .regularSquare
        closeButton.isBordered = false
        closeButton.imagePosition = .imageOnly
        let xmarkImage = NSImage(systemSymbolName: "xmark", accessibilityDescription: "Close")?
            .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: 12, weight: .medium))
        closeButton.image = xmarkImage
        closeButton.contentTintColor = .secondaryLabelColor
        closeButton.target = self
        closeButton.action = #selector(closeButtonClicked)
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        contentView?.addSubview(closeButton)
        NSLayoutConstraint.activate([
            closeButton.widthAnchor.constraint(equalToConstant: 20),
            closeButton.heightAnchor.constraint(equalToConstant: 20),
            closeButton.topAnchor.constraint(equalTo: contentView!.topAnchor, constant: 6),
            closeButton.trailingAnchor.constraint(equalTo: contentView!.trailingAnchor, constant: -8),
        ])
    }

    private func setupClient() {
        client.onToken = { [weak self] token in
            self?.appendToken(token)
        }
        client.onComplete = { [weak self] in
            self?.streamDidComplete()
        }
        client.onError = { [weak self] message in
            self?.streamDidFail(message)
        }
    }

    // MARK: - Actions

    @objc private func closeButtonClicked() {
        dismiss()
    }

    // MARK: - Input

    @objc private func inputDidSubmit() {
        let prompt = inputField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else { return }

        log("inputDidSubmit() prompt=\(prompt.prefix(80))")

        // Add user bubble
        let userBubble = ChatBubbleView(role: .user)
        userBubble.setText(prompt)
        chatStack.addArrangedSubview(userBubble)
        chatScroll.isHidden = false

        inputField.stringValue = ""
        inputField.isEditable = false
        spinner.isHidden = false
        spinner.startAnimation(nil)

        growPanelIfNeeded()
        scrollToBottom()

        client.send(prompt: prompt)
    }

    // MARK: - Streaming

    private func appendToken(_ token: String) {
        log("appendToken(\(token.prefix(50))) panelH=\(frame.height)")

        if currentBubble == nil {
            spinner.isHidden = true
            spinner.stopAnimation(nil)
            let bubble = ChatBubbleView(role: .model)
            currentBubble = bubble
            chatStack.addArrangedSubview(bubble)
        }

        currentBubble?.appendText(token)
        growPanelIfNeeded()
        scrollToBottom()

        log("appendToken done: scrollH=\(scrollHeightConstraint.constant) panelH=\(frame.height)")
    }

    private func streamDidComplete() {
        log("streamDidComplete()")
        spinner.isHidden = true
        spinner.stopAnimation(nil)
        currentBubble = nil
        inputField.isEditable = true
        makeFirstResponder(inputField)
    }

    private func streamDidFail(_ message: String) {
        log("streamDidFail(\(message))")
        spinner.isHidden = true
        spinner.stopAnimation(nil)
        currentBubble = nil

        // Show error as a model bubble in red
        let errorBubble = ChatBubbleView(role: .model)
        errorBubble.setText(message)
        chatStack.addArrangedSubview(errorBubble)
        chatScroll.isHidden = false

        inputField.isEditable = true
        makeFirstResponder(inputField)
        growPanelIfNeeded()
        scrollToBottom()
    }

    // MARK: - Geometry

    private func positionOnScreen() {
        guard let screen = NSScreen.main else { return }
        let screenFrame = screen.visibleFrame
        let x = screenFrame.midX - panelWidth / 2
        let y = screenFrame.origin.y + screenFrame.height * 2 / 3
        setFrame(NSRect(x: x, y: y, width: panelWidth, height: minHeight), display: true)
    }

    private func resetToMinHeight() {
        scrollHeightConstraint.constant = 0
        var f = frame
        let topEdge = f.origin.y + f.size.height
        f.size.height = minHeight
        f.origin.y = topEdge - minHeight
        setFrame(f, display: true)
    }

    private func growPanelIfNeeded() {
        chatStack.layoutSubtreeIfNeeded()
        let contentHeight = chatStack.fittingSize.height

        // Fixed overhead: top padding + input + spacing + bottom padding
        let overhead: CGFloat = padding + 44 + 6 + (spinner.isHidden ? 0 : 18 + 6) + padding
        let desiredHeight = min(overhead + contentHeight + 16, maxHeight)

        log("growPanel: contentH=\(contentHeight) overhead=\(overhead) desired=\(desiredHeight) current=\(frame.height) spinnerHidden=\(spinner.isHidden)")

        guard desiredHeight > frame.height else { return }

        let scrollH = desiredHeight - overhead
        scrollHeightConstraint.constant = scrollH

        let topEdge = frame.origin.y + frame.size.height
        let newFrame = NSRect(x: frame.origin.x, y: topEdge - desiredHeight, width: panelWidth, height: desiredHeight)

        log("growPanel: scrollH=\(scrollH) newPanelH=\(desiredHeight)")

        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.15
            ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
            self.animator().setFrame(newFrame, display: true)
        }
    }

    private func scrollToBottom() {
        if let documentView = chatScroll.documentView {
            let maxScroll = NSPoint(x: 0, y: documentView.frame.maxY - chatScroll.contentSize.height)
            chatScroll.contentView.scroll(to: maxScroll)
            chatScroll.reflectScrolledClipView(chatScroll.contentView)
        }
    }

    private func log(_ msg: String) {
        DebugLog.write("[PromptPanel] \(msg)")
    }
}
