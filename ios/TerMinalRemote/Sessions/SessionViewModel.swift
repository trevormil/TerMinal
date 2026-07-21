import Foundation
import SwiftUI

/// Drives one attached terminal: opens the stream, replays the current screen,
/// pumps live output into the mirror, and forwards keystrokes back.
@Observable
final class SessionViewModel {
    enum State: Equatable {
        case connecting
        case live
        case ended(code: Int)
        case failed(String)
    }

    private(set) var state: State = .connecting
    let session: BridgeSession

    private let client: BridgeClient
    private var controller: TerminalMirrorController?
    private var streamTask: Task<Void, Never>?
    /// Output that arrived before the view existed, replayed on attach.
    private var pending: [Data] = []

    init(session: BridgeSession, client: BridgeClient) {
        self.session = session
        self.client = client
    }

    func attach(_ controller: TerminalMirrorController) {
        self.controller = controller
        controller.setGeometry(cols: session.cols, rows: session.rows)
        for chunk in pending { controller.feed(chunk) }
        pending = []
    }

    func start() {
        guard streamTask == nil else { return }
        streamTask = Task { [weak self] in
            guard let self else { return }
            do {
                for try await event in client.stream(key: session.key) {
                    await MainActor.run { self.handle(event) }
                }
                // The stream closed without an explicit exit frame — the Mac
                // went away rather than the pty finishing.
                await MainActor.run {
                    if case .live = self.state { self.state = .failed("Connection lost.") }
                }
            } catch is CancellationError {
                // Leaving the screen; nothing to report.
            } catch {
                await MainActor.run {
                    self.state = .failed(error.localizedDescription)
                }
            }
        }
    }

    func stop() {
        streamTask?.cancel()
        streamTask = nil
    }

    @MainActor
    private func handle(_ event: TerminalEvent) {
        switch event {
        case .hello(let cols, let rows, _, let replay):
            controller?.setGeometry(cols: cols, rows: rows)
            feed(replay)
            state = .live
        case .output(let bytes):
            if case .connecting = state { state = .live }
            feed(bytes)
        case .exit(let code):
            state = .ended(code: code)
        }
    }

    private func feed(_ bytes: Data) {
        guard !bytes.isEmpty else { return }
        if let controller {
            controller.feed(bytes)
        } else {
            pending.append(bytes)
        }
    }

    /// Keystrokes → the Mac's pty. Fire-and-forget: a dropped keystroke is
    /// better than blocking the keyboard on a round trip.
    func send(_ data: Data) {
        Task { [client, session] in
            try? await client.send(key: session.key, bytes: data)
        }
    }

    func send(text: String) {
        guard let data = text.data(using: .utf8) else { return }
        send(data)
    }
}
