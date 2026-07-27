import SwiftUI

@Observable
final class WorkspaceViewModel {
    let client: BridgeClient
    let repo: RepoOption

    private(set) var sessions: [RemoteSession] = []
    private(set) var tickets: [WsTicket] = []
    private(set) var prs: [WsPr] = []
    private(set) var runs: [WsRun] = []
    private(set) var schedules: [WsSchedule] = []
    private(set) var ciRuns: [CiRun] = []
    private(set) var error: String?
    var loading = false

    init(client: BridgeClient, repo: RepoOption) {
        self.client = client
        self.repo = repo
    }

    /// Sessions registered in this repo (the bridge lists them all; filter here).
    /// The desktop stores a session's repo as the full path OR its basename, and
    /// scratch has its own name — so match on any of those rather than one form.
    @MainActor
    func loadSessions() async {
        do {
            let (all, _) = try await client.remote()
            let base = (repo.path as NSString).lastPathComponent
            sessions = all.filter {
                $0.repo == repo.name || $0.repo == repo.path || $0.repo == base
            }
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    @MainActor
    func load(_ tab: WorkspaceTab) async {
        loading = true
        defer { loading = false }
        do {
            switch tab {
            case .sessions: await loadSessions()
            case .tickets: tickets = try await client.tickets(repo: repo.path)
            case .prs: prs = try await client.prs(repo: repo.path)
            case .runs: runs = try await client.runs(repo: repo.path)
            case .schedules: schedules = try await client.schedules(repo: repo.path)
            case .ci: ciRuns = try await client.ci(repo: repo.path)
            }
            if tab != .sessions { error = nil }
        } catch { self.error = error.localizedDescription }
    }

    @MainActor func terminate(_ s: RemoteSession) async {
        try? await client.endSession(id: s.id)
        await loadSessions()
    }
    @MainActor func delete(_ s: RemoteSession) async {
        sessions.removeAll { $0.id == s.id }
        try? await client.deleteSession(id: s.id)
        await loadSessions()
    }
}

enum WorkspaceTab: String, CaseIterable, Identifiable {
    case sessions, tickets, prs, runs, schedules, ci
    var id: String { rawValue }
    var icon: String {
        switch self {
        case .sessions: return "bolt.horizontal"
        case .tickets: return "ticket"
        case .prs: return "arrow.triangle.pull"
        case .runs: return "play.rectangle"
        case .schedules: return "clock"
        case .ci: return "checkmark.seal"
        }
    }
    var label: String {
        switch self {
        case .sessions: return "Sessions"
        case .tickets: return "Tickets"
        case .prs: return "PRs"
        case .runs: return "Runs"
        case .schedules: return "Schedules"
        case .ci: return "CI"
        }
    }
    /// One-line hint under each menu row.
    var subtitle: String {
        switch self {
        case .sessions: return "Live terminals you can steer"
        case .tickets: return "Backlog & in-progress"
        case .prs: return "Open pull requests"
        case .runs: return "Recent agent runs"
        case .schedules: return "Scheduled agents"
        case .ci: return "Latest CI runs"
        }
    }
}

/// One repo's cockpit — a GitHub-app-style menu. The root lists the sections
/// (Sessions, Tickets, PRs, Runs, Schedules, CI) as rows; tapping one pushes a
/// full screen for that section. Sessions you can steer; the rest are read-only.
struct WorkspaceView: View {
    @State var model: WorkspaceViewModel
    @State private var startingNew = false
    @State private var opened: RemoteSession?

    /// CI only appears when the repo actually has CI configured.
    private var sections: [WorkspaceTab] {
        WorkspaceTab.allCases.filter { $0 != .ci || model.repo.hasCi }
    }

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 8) {
                    ForEach(sections) { t in
                        NavigationLink(value: t) { WorkspaceMenuRow(tab: t) }
                            .buttonStyle(.plain)
                    }
                    // New Session lives on the Sessions screen too, but surface it
                    // here so it's one tap from the workspace root on first load.
                    Button { startingNew = true } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "plus")
                            Text("New session")
                        }
                        .frame(maxWidth: .infinity)
                        .gtSecondaryButton()
                    }
                    .padding(.top, 4)
                }
                .padding(14)
            }
        }
        .navigationTitle(model.repo.name)
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        // Registered here so section screens deeper in the stack can push a
        // section or a session thread by value.
        .navigationDestination(for: WorkspaceTab.self) { t in
            WorkspaceSectionView(model: model, section: t)
        }
        .navigationDestination(for: RemoteSession.self) { s in
            RemoteThreadView(model: RemoteThreadViewModel(session: s, client: model.client))
        }
        // A freshly started session opens straight into its thread.
        .navigationDestination(item: $opened) { s in
            RemoteThreadView(model: RemoteThreadViewModel(session: s, client: model.client))
        }
        .sheet(isPresented: $startingNew) {
            NewSessionSheet(client: model.client, repo: model.repo) { session in
                await MainActor.run { opened = session }
                Task { await model.loadSessions() }
            }
        }
    }
}

/// A single tappable section row: tinted icon, label, one-line hint, chevron.
private struct WorkspaceMenuRow: View {
    let tab: WorkspaceTab

    var body: some View {
        GTPanel {
            HStack(spacing: 12) {
                Image(systemName: tab.icon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(GT.accentLight)
                    .frame(width: 34, height: 34)
                    .background(GT.accent.opacity(0.15))
                    .clipShape(RoundedRectangle(cornerRadius: 9))
                VStack(alignment: .leading, spacing: 2) {
                    Text(tab.label).font(GT.sans(15, .semibold)).foregroundStyle(GT.text)
                    Text(tab.subtitle).font(GT.sans(11)).foregroundStyle(GT.textMuted)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(GT.textFaint)
            }
        }
    }
}

/// A single section's full screen: loads its slice on appear, pull-to-refresh,
/// and (for Sessions) the new-session flow.
struct WorkspaceSectionView: View {
    let model: WorkspaceViewModel
    let section: WorkspaceTab
    @State private var startingNew = false
    @State private var opened: RemoteSession?
    @State private var showClosedTickets = false

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if let error = model.error {
                        GTPanel { Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow) }
                    }
                    content
                }
                .padding(14)
            }
            .refreshable { await model.load(section) }
            .overlay { if model.loading { ProgressView().tint(GT.accentLight) } }
        }
        .navigationTitle(section.label)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        // A freshly started session — programmatic push, distinct from the
        // value-based session links (handled by WorkspaceView's destination).
        .navigationDestination(item: $opened) { s in
            RemoteThreadView(model: RemoteThreadViewModel(session: s, client: model.client))
        }
        .sheet(isPresented: $startingNew) {
            NewSessionSheet(client: model.client, repo: model.repo) { session in
                // Navigate immediately to the synthesized session — no waiting on
                // a list round trip. Refresh the list detached so the "Starting…"
                // button dismisses at once, not after the refresh.
                await MainActor.run { opened = session }
                Task { await model.loadSessions() }
            }
        }
        .task { await model.load(section) }
    }

    /// Tickets, with an open/all lens. A backlog is mostly closed tickets, so
    /// scrolling past them to find live work is the common case worth cutting.
    @ViewBuilder private var ticketsTab: some View {
        let shown = showClosedTickets ? model.tickets : model.tickets.filter { !$0.isDone }
        Picker("", selection: $showClosedTickets) {
            Text("Open").tag(false)
            Text("All").tag(true)
        }
        .pickerStyle(.segmented)
        .padding(.bottom, 4)
        list(shown, empty: showClosedTickets ? "No tickets" : "No open tickets") { t in
            NavigationLink {
                TicketDetailView(client: model.client, repo: model.repo.path, slug: t.slug)
            } label: { TicketRow(t: t) }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder private var content: some View {
        switch section {
        case .sessions:
            sessionsTab
        case .tickets:
            ticketsTab
        case .prs:
            list(model.prs, empty: "No open PRs") { pr in
                NavigationLink {
                    PrDetailView(client: model.client, repo: model.repo.path, iid: pr.iid)
                } label: { PrRow(pr: pr) }
                .buttonStyle(.plain)
            }
        case .runs:
            list(model.runs, empty: "No runs yet") { run in
                NavigationLink {
                    RunDetailView(client: model.client, run: run)
                } label: { RunRow(run: run) }
                .buttonStyle(.plain)
            }
        case .schedules:
            list(model.schedules, empty: "No schedules") { s in
                NavigationLink {
                    ScheduleDetailView(client: model.client, repo: model.repo.path, id: s.id)
                } label: { ScheduleRow(s: s) }
                .buttonStyle(.plain)
            }
        case .ci:
            ciContent
        }
    }

    @ViewBuilder private var ciContent: some View {
        if model.ciRuns.isEmpty && !model.loading {
            GTPanel {
                Text("No recent CI runs (or the forge CLI isn't authenticated on your Mac).")
                    .font(GT.sans(12)).foregroundStyle(GT.textMuted)
            }
        }
        ForEach(Array(Ci.grouped(model.ciRuns).enumerated()), id: \.offset) { _, group in
            Text(group.name.uppercased())
                .font(GT.sans(10, .semibold)).tracking(0.8).foregroundStyle(GT.textFaint)
                .padding(.top, 2)
            ForEach(group.runs) { run in
                NavigationLink {
                    CiRunDetailView(client: model.client, repo: model.repo.path, run: run)
                } label: { CiRunRow(run: run) }
                .buttonStyle(.plain)
            }
        }
    }

    private var sessionsTab: some View {
        VStack(alignment: .leading, spacing: 10) {
            if model.sessions.isEmpty && !model.loading {
                GTPanel {
                    Text("No sessions in this repo. Start one, or run /remote-terminal on your Mac.")
                        .font(GT.sans(12)).foregroundStyle(GT.textMuted)
                }
            }
            ForEach(model.sessions) { s in
                NavigationLink(value: s) { SessionRow(session: s) }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button("Terminate", systemImage: "stop.circle") {
                            Task { await model.terminate(s) }
                        }
                        Button("Delete", systemImage: "trash", role: .destructive) {
                            Task { await model.delete(s) }
                        }
                    }
            }
            Button { startingNew = true } label: {
                HStack(spacing: 8) {
                    Image(systemName: "plus")
                    Text("New session")
                }
                .frame(maxWidth: .infinity)
                .gtSecondaryButton()
            }
            .padding(.top, 2)
        }
    }

    @ViewBuilder
    private func list<T: Identifiable, Row: View>(
        _ items: [T], empty: String, @ViewBuilder row: @escaping (T) -> Row
    ) -> some View {
        if items.isEmpty && !model.loading {
            GTPanel { Text(empty).font(GT.sans(12)).foregroundStyle(GT.textMuted) }
        }
        ForEach(items) { row($0) }
    }
}
