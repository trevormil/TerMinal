import PhotosUI
import SwiftUI

@Observable
final class RemoteThreadViewModel {
    private(set) var messages: [RemoteMessage] = []
    private(set) var status: String
    private(set) var question: String?
    private(set) var error: String?
    private(set) var loading = true
    private(set) var sending = false

    let session: RemoteSession
    let client: BridgeClient
    private var poll: Task<Void, Never>?
    private var inFlight: Task<Void, Never>?

    var isAwaiting: Bool { status == "awaiting" }
    var hasEnded: Bool { status == "ended" }

    init(session: RemoteSession, client: BridgeClient) {
        self.session = session
        self.client = client
        self.status = session.status
        self.question = session.question
    }

    @MainActor
    func refresh() async {
        // send() and the poll tick can call this concurrently; two identical
        // `after` fetches would append the same page twice. Piggyback on the
        // in-flight refresh instead of racing it.
        if let inFlight { return await inFlight.value }
        let task = Task { await performRefresh() }
        inFlight = task
        defer { inFlight = nil }
        await task.value
    }

    @MainActor
    private func performRefresh() async {
        defer { loading = false }
        do {
            // Ask only for what we don't have — this polls every couple of
            // seconds and a long session's log keeps growing.
            let after = messages.count
            let page = try await client.messages(id: session.id, after: after)
            if Self.shouldApply(
                pageCount: page.messages.count, requestedAfter: after,
                currentCount: messages.count
            ) {
                messages.append(contentsOf: page.messages)
            }
            status = page.status
            question = page.question
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Whether a fetched page may be appended: only if nothing else grew the
    /// transcript while the request was in flight (belt-and-suspenders under
    /// the in-flight guard above).
    static func shouldApply(pageCount: Int, requestedAfter: Int, currentCount: Int) -> Bool {
        pageCount > 0 && currentCount == requestedAfter
    }

    func start() {
        guard poll == nil else { return }
        poll = Task { [self] in
            while !Task.isCancelled {
                await refresh()
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    func stop() {
        poll?.cancel()
        poll = nil
    }

    @MainActor
    func send(_ text: String, image: Data? = nil) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty || image != nil else { return }
        sending = true
        defer { sending = false }
        do {
            let images: [(ext: String, data: Data)] = image.map { [("jpg", $0)] } ?? []
            try await client.reply(id: session.id, text: trimmed, images: images)
            // Don't echo locally: the Mac's log is the source of truth, and the
            // next poll picks the message up.
            await refresh()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct RemoteThreadView: View {
    @State var model: RemoteThreadViewModel
    @State private var draft = ""
    @State private var pickerItem: PhotosPickerItem?
    @State private var pendingImage: Data?
    @FocusState private var composerFocused: Bool

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                transcript
                if model.hasEnded { endedBanner } else { composer }
            }
        }
        .navigationTitle(model.session.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(model.messages) { message in
                        MessageBubble(
                            message: message, sessionId: model.session.id, client: model.client
                        ).id(message.id)
                    }
                    if model.isAwaiting, let question = model.question {
                        AwaitingBanner(question: question)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(14)
            }
            .onChange(of: model.messages.count) {
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) }
            }
        }
    }

    private var canSend: Bool { !draft.isEmpty || pendingImage != nil }

    private var endedBanner: some View {
        HStack(spacing: 6) {
            Image(systemName: "checkmark.circle").font(.system(size: 11))
            Text("Session finished").font(GT.sans(12))
        }
        .foregroundStyle(GT.textFaint)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(GT.panel)
    }

    private var composer: some View {
        VStack(spacing: 0) {
            Divider().overlay(GT.border)
            if let pending = pendingImage, let ui = UIImage(data: pending) {
                HStack(spacing: 8) {
                    Image(uiImage: ui)
                        .resizable().scaledToFill()
                        .frame(width: 44, height: 44)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    Text("Image attached").font(GT.sans(12)).foregroundStyle(GT.textMuted)
                    Spacer()
                    Button {
                        pendingImage = nil
                        pickerItem = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(GT.textFaint)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.top, 8)
            }
            HStack(spacing: 8) {
                PhotosPicker(selection: $pickerItem, matching: .images) {
                    Image(systemName: "photo").font(.system(size: 20)).foregroundStyle(GT.textMuted)
                }
                .onChange(of: pickerItem) {
                    Task {
                        // Re-encode to JPEG so a HEIC screenshot renders anywhere.
                        if let data = try? await pickerItem?.loadTransferable(type: Data.self),
                            let ui = UIImage(data: data) {
                            pendingImage = ui.jpegData(compressionQuality: 0.8)
                        }
                    }
                }
                TextField(
                    model.isAwaiting ? "Answer the agent" : "Send a message",
                    text: $draft,
                    axis: .vertical
                )
                .lineLimit(1...5)
                .font(GT.sans(14))
                .foregroundStyle(GT.text)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.sentences)
                .focused($composerFocused)
                .accessibilityIdentifier("remote-composer")
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(Color.black.opacity(0.35))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(model.isAwaiting ? GT.accent2.opacity(0.5) : GT.border, lineWidth: 1)
                )

                Button {
                    let text = draft
                    let image = pendingImage
                    draft = ""
                    pendingImage = nil
                    pickerItem = nil
                    Task { await model.send(text, image: image) }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 27))
                        .foregroundStyle(canSend ? GT.accent : GT.textFaint)
                }
                .disabled(!canSend || model.sending)
                .accessibilityLabel("Send")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
        }
        .background(GT.panel)
    }
}

/// The agent is blocked in `ask` — say so, so a reply feels answered rather
/// than shouted into a log.
private struct AwaitingBanner: View {
    let question: String

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: "questionmark.circle.fill")
                .font(.system(size: 12))
                .foregroundStyle(GT.accent2)
            Text("Waiting on your answer")
                .font(GT.sans(12, .medium))
                .foregroundStyle(GT.accent2)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 8)
        .background(GT.accent2.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct MessageBubble: View {
    let message: RemoteMessage
    let sessionId: String
    let client: BridgeClient

    var body: some View {
        HStack {
            if !message.isAgent { Spacer(minLength: 40) }
            VStack(alignment: message.isAgent ? .leading : .trailing, spacing: 6) {
                if let images = message.images, !images.isEmpty {
                    ForEach(images, id: \.self) { name in
                        RemoteImage(sessionId: sessionId, name: name, client: client)
                    }
                }
                if !message.text.isEmpty {
                    Group {
                        if message.isAgent {
                            // The agent's prose may be Markdown; yours is plain.
                            MarkdownText(raw: message.text)
                        } else {
                            Text(message.text).font(GT.sans(14)).foregroundStyle(GT.text)
                                .textSelection(.enabled)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(message.isAgent ? GT.panel2 : GT.accent.opacity(0.22))
                    .clipShape(RoundedRectangle(cornerRadius: 13))
                    .overlay(
                        RoundedRectangle(cornerRadius: 13)
                            .stroke(
                                message.isAgent ? GT.border : GT.accent.opacity(0.35), lineWidth: 1)
                    )
                    // Selection only ever works inside ONE Text, so it can't copy
                    // a whole multi-block message. Long-press gives a reliable
                    // copy of the entire message, code fences and all.
                    .contextMenu {
                        Button("Copy message", systemImage: "doc.on.doc") {
                            UIPasteboard.general.string = message.text
                        }
                    }
                }
            }
            if message.isAgent { Spacer(minLength: 40) }
        }
    }
}

/// An attached image, fetched over the pinned, authenticated session.
private struct RemoteImage: View {
    let sessionId: String
    let name: String
    let client: BridgeClient
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 260, maxHeight: 320)
                    .clipShape(RoundedRectangle(cornerRadius: 11))
                    .overlay(RoundedRectangle(cornerRadius: 11).stroke(GT.border, lineWidth: 1))
            } else {
                RoundedRectangle(cornerRadius: 11)
                    .fill(GT.panel2)
                    .frame(width: 160, height: 120)
                    .overlay(ProgressView().tint(GT.textFaint))
            }
        }
        .task {
            if let data = await client.imageData(id: sessionId, name: name) {
                image = UIImage(data: data)
            }
        }
    }
}
