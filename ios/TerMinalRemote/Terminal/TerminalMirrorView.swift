import SwiftTerm
import SwiftUI
import UIKit

/// A read-geometry mirror of one desktop terminal.
///
/// The phone renders the session at the Mac's own cols×rows and NEVER resizes
/// the pty: a reflow here would rewrap the terminal the human is looking at on
/// the desktop. The grid is therefore laid out at its natural size inside a
/// zoomable scroll view — pinch and pan instead of reflowing.
final class TerminalMirrorController: UIViewController {
    private let scrollView = UIScrollView()
    let terminalView = TerminalView()
    /// Keystrokes typed into the terminal, forwarded to the bridge.
    var onSend: ((Data) -> Void)?

    private var grid = (cols: 80, rows: 24)
    private var baseFontSize: CGFloat = 11

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        terminalView.terminalDelegate = self
        terminalView.backgroundColor = .black
        terminalView.isOpaque = true
        terminalView.font = UIFont.monospacedSystemFont(ofSize: baseFontSize, weight: .regular)

        scrollView.delegate = self
        scrollView.minimumZoomScale = 0.4
        scrollView.maximumZoomScale = 4
        scrollView.bouncesZoom = false
        scrollView.backgroundColor = .black
        scrollView.showsHorizontalScrollIndicator = true
        scrollView.addSubview(terminalView)

        scrollView.frame = view.bounds
        scrollView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(scrollView)
    }

    /// Adopt the desktop's geometry. Called on the stream's `hello` frame.
    func setGeometry(cols: Int, rows: Int) {
        grid = (max(cols, 1), max(rows, 1))
        relayout()
    }

    func feed(_ bytes: Data) {
        terminalView.feed(byteArray: ArraySlice(bytes))
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        relayout()
    }

    private func relayout() {
        guard view.bounds.width > 0 else { return }
        terminalView.resize(cols: grid.cols, rows: grid.rows)
        let optimal = terminalView.getOptimalFrameSize()
        guard optimal.width > 0, optimal.height > 0 else { return }
        terminalView.frame = optimal
        scrollView.contentSize = optimal.size
        // Start at the zoom level that fits the full width — the whole point is
        // seeing the agent's output without horizontal panning by default.
        let fit = min(1, view.bounds.width / optimal.width)
        scrollView.minimumZoomScale = min(0.4, fit)
        if scrollView.zoomScale == 1 || scrollView.zoomScale < scrollView.minimumZoomScale {
            scrollView.zoomScale = fit
        }
    }
}

extension TerminalMirrorController: UIScrollViewDelegate {
    func viewForZooming(in scrollView: UIScrollView) -> UIView? { terminalView }
}

extension TerminalMirrorController: TerminalViewDelegate {
    /// The user typed. Forward to the Mac instead of echoing locally — the pty
    /// is the single source of truth for what the screen shows.
    func send(source: TerminalView, data: ArraySlice<UInt8>) {
        onSend?(Data(data))
    }

    /// The remote app asked for a different size (rare: DECCOLM and friends).
    /// Ignored on purpose — geometry is owned by the desktop.
    func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {}
    func setTerminalTitle(source: TerminalView, title: String) {}
    func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
    func scrolled(source: TerminalView, position: Double) {}
    func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {
        guard let url = URL(string: link), UIApplication.shared.canOpenURL(url) else { return }
        UIApplication.shared.open(url)
    }
    func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
}

/// SwiftUI wrapper. `feedToken` lets the view model push bytes without the
/// representable re-creating the controller on every frame.
struct TerminalMirror: UIViewControllerRepresentable {
    let model: SessionViewModel

    func makeUIViewController(context: Context) -> TerminalMirrorController {
        let controller = TerminalMirrorController()
        controller.onSend = { [weak model] data in model?.send(data) }
        model.attach(controller)
        return controller
    }

    func updateUIViewController(_ controller: TerminalMirrorController, context: Context) {}
}
