import SwiftUI

/// First run: scan (or paste) the code from TerMinal → Settings → Mobile.
struct PairingView: View {
    let onPaired: (PairingPayload) -> Void

    @State private var scanning = false
    @State private var tailscaling = false
    @State private var tailscaleHost = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ZStack {
        GT.bg.ignoresSafeArea()
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "terminal.fill")
                .font(.system(size: 52))
                .foregroundStyle(GT.gradient)
            VStack(spacing: 8) {
                Text("Pair with your Mac")
                    .font(GT.sans(22, .semibold))
                    .foregroundStyle(GT.text)
                Text("On your Mac, open TerMinal → Settings → Mobile and turn on the bridge.")
                    .font(GT.sans(14))
                    .foregroundStyle(GT.textMuted)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 32)

            if let error {
                Text(error)
                    .font(.system(size: 13))
                    .foregroundStyle(.orange)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            VStack(spacing: 10) {
                Button {
                    error = nil
                    scanning = true
                } label: {
                    Label("Scan QR code", systemImage: "qrcode.viewfinder")
                        .frame(maxWidth: .infinity, minHeight: 46)
                }
                .buttonStyle(.borderedProminent)
                .tint(GT.accent)

                Button {
                    error = nil
                    tailscaling = true
                } label: {
                    Label("Pair over Tailscale", systemImage: "network")
                        .frame(maxWidth: .infinity, minHeight: 46)
                }
                .buttonStyle(.bordered)
                .tint(GT.accent2)

                // No intermediate editor sheet: pasting IS the action. Use
                // "Copy pairing code" on the Mac, then tap this — one step, and
                // nobody ever wants to hand-edit the JSON.
                Button("Paste pairing code") {
                    error = nil
                    guard let clip = UIPasteboard.general.string, !clip.isEmpty else {
                        error = "Your clipboard is empty. Use “Copy pairing code” in "
                            + "TerMinal → Settings → Mobile."
                        return
                    }
                    accept(clip)
                }
                .font(GT.sans(14))
                .foregroundStyle(GT.accentLight)
            }
            .padding(.horizontal, 32)
            Spacer()
        }
        }
        .sheet(isPresented: $tailscaling) { tailscaleSheet }
        .sheet(isPresented: $scanning) {
            NavigationStack {
                QRScanner(
                    onCode: { accept($0); scanning = false },
                    onUnavailable: { message in
                        error = message
                        scanning = false
                    }
                )
                .ignoresSafeArea()
                .navigationTitle("Scan")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Cancel") { scanning = false }
                    }
                }
            }
        }
    }

    private var tailscaleSheet: some View {
        NavigationStack {
            ZStack {
                GT.bg.ignoresSafeArea()
                VStack(alignment: .leading, spacing: 14) {
                    Text(
                        "Both devices need Tailscale, signed in to the same account. "
                            + "Enter your Mac's Tailscale name — it's shown in "
                            + "TerMinal → Settings → Mobile."
                    )
                    .font(GT.sans(13))
                    .foregroundStyle(GT.textMuted)

                    TextField("mac-name.tailnet.ts.net[:port]", text: $tailscaleHost)
                        .font(GT.mono(14))
                        .foregroundStyle(GT.text)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(Color.black.opacity(0.35))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(GT.border, lineWidth: 1))

                    if let error {
                        Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow)
                    }

                    Button {
                        Task { await pairTailscale() }
                    } label: {
                        HStack {
                            if busy { ProgressView().tint(.white).scaleEffect(0.8) }
                            Text(busy ? "Pairing…" : "Pair")
                        }
                        .frame(maxWidth: .infinity, minHeight: 46)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(GT.accent2)
                    .disabled(busy || tailscaleHost.trimmingCharacters(in: .whitespaces).isEmpty)

                    Spacer()
                }
                .padding(16)
            }
            .navigationTitle("Pair over Tailscale")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(GT.panel, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { tailscaling = false }
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func pairTailscale() async {
        error = nil
        busy = true
        defer { busy = false }
        var host = tailscaleHost.trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: "https://", with: "")
            .replacingOccurrences(of: "/", with: "")
        // Accept an optional :port — the bridge default is 8790, but Settings
        // may run it elsewhere, and a tailnet pair can't read the QR's port.
        var port = 8790
        if let colon = host.lastIndex(of: ":"),
            let p = Int(host[host.index(after: colon)...])
        {
            port = p
            host = String(host[..<colon])
        }
        do {
            let payload = try await TailscalePairing.pair(host: host, port: port)
            tailscaling = false
            onPaired(payload)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func accept(_ raw: String) {
        do {
            onPaired(try PairingPayload.decode(raw))
        } catch {
            self.error = error.localizedDescription
        }
    }
}
