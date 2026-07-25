import SwiftUI

/// First run: scan (or paste) the code from TerMinal → Settings → Mobile.
struct PairingView: View {
    let onPaired: (PairingPayload) -> Void

    @State private var scanning = false
    @State private var tailscaling = false
    @State private var tailscaleHost = ""
    @State private var busy = false
    @State private var error: String?
    @State private var recents: [RecentHost] = []
    @FocusState private var hostFieldFocused: Bool

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 24) {
                    identityHeader
                        .padding(.top, 36)

                    stepsPanel

                    if let error {
                        Text(error)
                            .font(GT.sans(13))
                            .foregroundStyle(GT.yellow)
                            .multilineTextAlignment(.center)
                    }

                    VStack(spacing: 12) {
                        Button {
                            error = nil
                            scanning = true
                        } label: {
                            Label("Scan QR code", systemImage: "qrcode.viewfinder")
                                .font(GT.sans(16, .semibold))
                                .frame(maxWidth: .infinity, minHeight: 52)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(GT.accent)

                        // No intermediate editor sheet: pasting IS the action.
                        // Use "Copy pairing code" on the Mac, then tap this —
                        // one step, and nobody ever wants to hand-edit the JSON.
                        Button {
                            error = nil
                            guard let clip = UIPasteboard.general.string, !clip.isEmpty else {
                                error = "Your clipboard is empty. Use “Copy pairing code” in "
                                    + "TerMinal → Settings → Mobile."
                                return
                            }
                            accept(clip)
                        } label: {
                            Label("Paste pairing code", systemImage: "doc.on.clipboard")
                                .frame(maxWidth: .infinity)
                                .gtSecondaryButton()
                        }
                        .buttonStyle(.plain)

                        Button {
                            error = nil
                            tailscaling = true
                        } label: {
                            Label("Pair over Tailscale", systemImage: "network")
                                .frame(maxWidth: .infinity)
                                .gtSecondaryButton()
                        }
                        .buttonStyle(.plain)

                        Text("Enter your Mac's MagicDNS name — no QR needed.")
                            .font(GT.sans(11))
                            .foregroundStyle(GT.textFaint)
                            .multilineTextAlignment(.center)
                            .padding(.top, 2)
                    }
                    Spacer(minLength: 24)
                }
                .padding(.horizontal, 24)
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

    /// App icon + wordmark: the first screen anyone sees, so it should look
    /// like the product, not a system placeholder.
    private var identityHeader: some View {
        VStack(spacing: 14) {
            Image("Logo")
                .resizable()
                .scaledToFit()
                .frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .overlay(
                    RoundedRectangle(cornerRadius: 16).stroke(GT.border, lineWidth: 1)
                )
            VStack(spacing: 6) {
                Text("TerMinal")
                    .font(GT.sans(28, .bold))
                    .foregroundStyle(GT.text)
                Text("Your agents, in your pocket.")
                    .font(GT.sans(14))
                    .foregroundStyle(GT.textMuted)
            }
        }
    }

    private var stepsPanel: some View {
        GTPanel(padding: 16) {
            VStack(alignment: .leading, spacing: 14) {
                step(1, "Open TerMinal on your Mac → Settings → Mobile.")
                step(2, "Turn on the bridge.")
                step(3, "Tap “Show pairing code” and scan the QR — or paste the copied code.")
            }
        }
    }

    private func step(_ number: Int, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text("\(number)")
                .font(GT.mono(13, .medium))
                .foregroundStyle(GT.accentLight)
                .frame(width: 24, height: 24)
                .background(GT.accent.opacity(0.15))
                .clipShape(Circle())
            Text(text)
                .font(GT.sans(14))
                .foregroundStyle(GT.textSoft)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var tailscaleSheet: some View {
        NavigationStack {
            ZStack {
                GT.bg.ignoresSafeArea().onTapGesture { hostFieldFocused = false }
                VStack(alignment: .leading, spacing: 14) {
                    Text(
                        "Both devices need Tailscale, signed in to the same account. "
                            + "Enter your Mac's Tailscale name — it's shown in "
                            + "TerMinal → Settings → Mobile."
                    )
                    .font(GT.sans(13))
                    .foregroundStyle(GT.textMuted)

                    // Machines paired before: one tap, no typing.
                    if !recents.isEmpty {
                        Text("YOUR MACS")
                            .font(GT.sans(10, .semibold))
                            .tracking(0.8)
                            .foregroundStyle(GT.textFaint)
                        VStack(spacing: 8) {
                            ForEach(recents) { host in
                                recentRow(host)
                            }
                        }
                        Text("or enter another")
                            .font(GT.sans(11))
                            .foregroundStyle(GT.textFaint)
                            .padding(.top, 2)
                    }

                    TextField("mac-name.tailnet.ts.net[:port]", text: $tailscaleHost)
                        .font(GT.mono(14))
                        .foregroundStyle(GT.text)
                        .focused($hostFieldFocused)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .submitLabel(.go)
                        .onSubmit { Task { await pairTailscale() } }
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
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { hostFieldFocused = false }
                }
            }
            .onAppear { recents = RecentHostsStore.all() }
        }
        .preferredColorScheme(.dark)
    }

    private func recentRow(_ host: RecentHost) -> some View {
        Button {
            hostFieldFocused = false
            Task { await pairTailscale(host: host.host, port: host.port) }
        } label: {
            GTPanel(padding: 12) {
                HStack(spacing: 10) {
                    Image(systemName: "desktopcomputer")
                        .font(.system(size: 15))
                        .foregroundStyle(GT.accentLight)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(host.name.isEmpty ? host.host : host.name)
                            .font(GT.sans(14, .medium))
                            .foregroundStyle(GT.text)
                        Text(host.display)
                            .font(GT.mono(11))
                            .foregroundStyle(GT.textFaint)
                    }
                    Spacer()
                    if busy {
                        ProgressView().tint(GT.accentLight).scaleEffect(0.7)
                    } else {
                        Image(systemName: "arrow.right.circle")
                            .font(.system(size: 15))
                            .foregroundStyle(GT.textFaint)
                    }
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .contextMenu {
            Button("Remove", role: .destructive) {
                RecentHostsStore.forget(host.id)
                recents = RecentHostsStore.all()
            }
        }
    }

    /// Pass an explicit host/port to pair with a remembered machine; otherwise
    /// it parses the text field (accepting an optional `:port`).
    private func pairTailscale(host explicitHost: String? = nil, port explicitPort: Int? = nil)
        async
    {
        error = nil
        busy = true
        defer { busy = false }
        var host: String
        var port: Int
        if let explicitHost {
            host = explicitHost
            port = explicitPort ?? 8790
        } else {
            host = tailscaleHost.trimmingCharacters(in: .whitespaces)
                .replacingOccurrences(of: "https://", with: "")
                .replacingOccurrences(of: "/", with: "")
            // Accept an optional :port — the bridge default is 8790, but Settings
            // may run it elsewhere, and a tailnet pair can't read the QR's port.
            port = 8790
            if let colon = host.lastIndex(of: ":"),
                let p = Int(host[host.index(after: colon)...])
            {
                port = p
                host = String(host[..<colon])
            }
        }
        do {
            let payload = try await TailscalePairing.pair(host: host, port: port)
            // Remember it so next time it's a tap, not a retype.
            RecentHostsStore.remember(RecentHost(host: host, port: port, name: payload.n))
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
