import type { Recording } from "../src/recorder";
import Quality, { Capabilities, type Care } from "./Quality";
import Intake from "./Intake";
import type { preflight, IntakePlan } from "../src/intake";
import Environments from "./Environments";
import Automate from "./Automate";
import CoverageLab from "./CoverageLab";
import PlanningScreen from "./Planning";
import {
  useEffect,
  useState,
  useId,
  cloneElement,
  type ReactElement,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Bell,
  BookOpen,
  Boxes,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  Clock3,
  Code2,
  FileCheck2,
  FileCode2,
  FileText,
  FlaskConical,
  GitBranch,
  GitCompareArrows,
  Globe2,
  HelpCircle,
  Layers3,
  LayoutDashboard,
  Link2,
  ListChecks,
  Loader2,
  Menu,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Terminal,
  Upload,
  Workflow,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Project, TestCase } from "../src/model";
import type { WorkspaceState } from "../src/workspace-server";
import type { ReviewItem } from "../src/maintenance";
import type { coverage } from "../src/coverage";
import type { audit } from "../src/audit";
type Data = WorkspaceState & {
  token: string;
  recording: (Recording & { candidateId: string }) | null;
  care: Care;
  intakeStatus: {
    plan: IntakePlan | null;
    stale: boolean;
    blockers: ReturnType<typeof preflight>;
  };
  agentConnection: {
    enabled: boolean;
    allowTrials: boolean;
    file: string | null;
  };
  authSessions: Record<string, Record<string, string>>;
  signIn: { id: string; environment: string; user: string } | null;
  reviews: Record<string, boolean>;
  coverage: ReturnType<typeof coverage>;
  audit: ReturnType<typeof audit>;
};
const navigation = [
  {
    label: "Workspace",
    items: [
      { id: "automate", label: "Automate", icon: Zap },
      { id: "intake", label: "Start from sources", icon: Workflow },
      { id: "quality", label: "Quality & maintenance", icon: Wrench },
      { id: "overview", label: "Overview", icon: LayoutDashboard },
    ],
  },
  {
    label: "Design & build",
    items: [
      { id: "planning", label: "Intake & sprint planning", icon: FileText },
      { id: "requirements", label: "Requirements", icon: FileText },
      { id: "tests", label: "Test library", icon: ListChecks },
      { id: "design", label: "Coverage Lab", icon: Target },
      { id: "catalog", label: "Automation catalog", icon: Boxes },
    ],
  },
  {
    label: "Run & understand",
    items: [
      { id: "runs", label: "Runs & reports", icon: Play },
      { id: "coverage", label: "Coverage map", icon: Target },
      { id: "release", label: "Release readiness", icon: ShieldCheck },
    ],
  },
  {
    label: "Keep it reliable",
    items: [
      { id: "maintenance", label: "Change inbox", icon: GitCompareArrows },
      { id: "environments", label: "Environments & accounts", icon: Settings2 },
      { id: "connections", label: "Connections & setup", icon: Link2 },
    ],
  },
];
const names = Object.fromEntries(
  navigation.flatMap((g) => g.items.map((i) => [i.id, i.label])),
);
const pretty = (v: unknown) => JSON.stringify(v, null, 2);
const pct = (n: number) => `${Math.round(n * 100)}%`;
function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Button({
  children,
  onClick,
  kind = "secondary",
  disabled = false,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      className={`button ${kind} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const dialog = document.querySelector('[role="dialog"]');
        const focusable = Array.from(
          dialog?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input,select,textarea,[tabindex="0"]',
          ) ?? [],
        );
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    document.querySelector<HTMLElement>('[role="dialog"] button')?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`modal ${wide ? "wide" : ""}`}
      >
        <div className="modal-heading">
          <div>
            <h2 id="modal-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function Empty({
  icon: Icon,
  title,
  body,
  children,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={25} />
      </span>
      <h3>{title}</h3>
      <p>{body}</p>
      {children}
    </div>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(
        children as ReactElement<{ id?: string; "aria-describedby"?: string }>,
        { id, "aria-describedby": hint ? `${id}-hint` : undefined },
      )}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
function Download({ name, value }: { name: string; value: unknown }) {
  return (
    <Button
      onClick={() => {
        const url = URL.createObjectURL(
          new Blob([pretty(value)], { type: "application/json" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}
    >
      <ArrowDownToLine size={16} /> Export JSON
    </Button>
  );
}
export default function App() {
  const [data, setData] = useState<Data | null>(null),
    [page, setPage] = useState(location.hash.slice(1) || "automate"),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [loading, setLoading] = useState(false),
    [mobile, setMobile] = useState(false);
  const [modal, setModalState] = useState<string | null>(null),
    [selectedTest, setSelectedTest] = useState<TestCase | null>(null),
    [selectedChange, setSelectedChange] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [runEnvironment, setRunEnvironment] = useState(""),
    [profile, setProfile] = useState("local"),
    [resolution, setResolution] = useState("");
  const [modalRevision, setModalRevision] = useState(0);
  const [moreTools, setMoreTools] = useState(false);
  const [qualityView, setQualityView] = useState("healing");
  function setModal(value: string | null) {
    setModalRevision(data?.revision ?? 0);
    setModalState(value);
  }
  async function refresh() {
    const response = await fetch("/api/workspace");
    if (!response.ok)
      throw new Error(
        "Workspace is unavailable. Start the local SuperQ server.",
      );
    const next = (await response.json()) as Data;
    setData(next);
    setRunEnvironment((current) =>
      current && next.project.environments[current]
        ? current
        : Object.keys(next.project.environments)[0],
    );
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => void refresh().catch(() => {}), 3000);
    const hash = () => {
      setPage(location.hash.slice(1) || "automate");
      setSearch("");
      setFilter("all");
    };
    window.addEventListener("hashchange", hash);
    window.addEventListener("popstate", hash);
    return () => {
      clearInterval(timer);
      window.removeEventListener("hashchange", hash);
      window.removeEventListener("popstate", hash);
    };
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  function go(next: string, query = "") {
    setPage(next);
    history.pushState(null, "", `#${next}`);
    setSearch(query);
    setMobile(false);
    setFilter("all");
  }
  async function mutate(
    path: string,
    body: Record<string, unknown>,
    message: string,
  ) {
    if (!data) return false;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-superq-token": data.token,
        },
        body: JSON.stringify({
          ...body,
          revision: modal ? modalRevision : data.revision,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save");
      await refresh();
      setToast(message);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setLoading(false);
    }
  }
  if (!data)
    return (
      <div className="boot">
        <span className="brand-symbol">S</span>
        <h1>SuperQ Studio</h1>
        <p>{error || "Preparing your quality workspace…"}</p>
        {error && <Button onClick={() => location.reload()}>Try again</Button>}
      </div>
    );
  const p = data.project,
    pending = data.plan?.items.filter((i) => i.status === "pending") ?? [],
    staged = data.plan?.items.filter((i) => i.status === "staged") ?? [];
  const currentItem =
    data.plan?.items.find((i) => i.id === selectedChange) ??
    pending[0] ??
    data.plan?.items[0];
  const ready = p.tests.filter(
    (t) =>
      t.status === "approved" &&
      t.steps.length &&
      t.steps.some((s) => s.assertions.length) &&
      !t.blockedBy.length,
  ).length;
  const latest = data.runs.find((r) => r.report)?.report;
  const edited = (test?: TestCase) => {
    setSelectedTest(test ? structuredClone(test) : null);
    setModal("test");
  };
  function status(t: TestCase) {
    return pending.some((i) => i.testId === t.id)
      ? "Needs review"
      : t.blockedBy.length
        ? "Blocked"
        : t.status === "draft"
          ? "Draft"
          : data?.reviews?.[t.id]
            ? "Reviewed"
            : "Ready for review";
  }
  const visibleTests = p.tests.filter(
    (t) =>
      `${t.id} ${t.title} ${t.tags.join(" ")} ${t.requirementIds.join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "all" || status(t) === filter),
  );
  const header = (
    eyebrow: string,
    title: string,
    description: string,
    actions?: ReactNode,
  ) => (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{actions}</div>
    </div>
  );
  return (
    <div className="app-shell">
      <button
        className="skip-link"
        onClick={() => document.getElementById("main-content")?.focus()}
      >
        Skip to workspace content
      </button>
      {mobile && <div className="nav-scrim" onClick={() => setMobile(false)} />}
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a className="brand" href="#automate" aria-label="SuperQ home">
          <span className="brand-symbol">
            S<span />
          </span>
          <span>
            super<span className="brand-q">Q</span>
            <small>QUALITY, CONNECTED.</small>
          </span>
        </a>
        <button className="project-switch" onClick={() => setModal("project")}>
          <span className="project-mark">{p.name.slice(0, 1)}</span>
          <span>
            {p.name}
            <small>
              {data.sample ? "Sample workspace" : "Local workspace"}
            </small>
          </span>
          <ChevronDown size={15} />
        </button>
        <nav aria-label="Primary navigation">
          {(moreTools
            ? navigation
            : [
                {
                  label: "Your workflow",
                  items: navigation
                    .flatMap((g) => g.items)
                    .filter((i) =>
                      [
                        "automate",
                        "intake",
                        "quality",
                        "tests",
                        "runs",
                        "maintenance",
                        "environments",
                        "connections",
                      ].includes(i.id),
                    ),
                },
              ]
          ).map((group) => (
            <div className="nav-group" key={group.label}>
              <span>{group.label}</span>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  className={`nav-link ${page === item.id ? "active" : ""}`}
                  onClick={() => go(item.id)}
                  aria-current={page === item.id ? "page" : undefined}
                >
                  <item.icon size={18} />
                  {item.label}
                  {item.id === "maintenance" && pending.length > 0 && (
                    <b>{pending.length}</b>
                  )}
                </button>
              ))}
            </div>
          ))}
          <button
            className="nav-link more-tools-toggle"
            aria-expanded={moreTools}
            onClick={() => setMoreTools(!moreTools)}
          >
            <Settings2 size={18} />
            {moreTools ? "Fewer tools" : "More tools"}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => setModal("guide")}>
            <BookOpen size={17} /> Your automation guide{" "}
            <ArrowRight size={15} />
          </button>
          <div className="local-user">
            <span>L</span>
            <div>
              Local workspace<small>Changes stay on this machine</small>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <b>{names[page] ?? "Overview"}</b>
          </div>
          <div className="topbar-actions">
            <span className="saved">
              <span className="online-dot" />{" "}
              {loading ? "Saving workspace…" : "Workspace saved"}
            </span>
            <button
              className="icon-button"
              title="Change notifications"
              aria-label={`Change notifications: ${pending.length} pending`}
              onClick={() => go("maintenance")}
            >
              <Bell size={19} />
              {pending.length > 0 && <i />}
            </button>
            <button
              className="icon-button"
              aria-label="Open help"
              onClick={() => setModal("guide")}
            >
              <HelpCircle size={19} />
            </button>
            <span className="avatar">L</span>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <Capabilities
            go={go}
            tests={p.tests.length}
            openQuality={(view) => {
              setQualityView(view);
              go("quality");
            }}
          />
          {page === "quality" && (
            <Quality
              key={JSON.stringify(p.healing)}
              view={qualityView}
              onViewChange={setQualityView}
              state={data}
              care={data.care}
              action={(path, body) =>
                mutate(path, body, "Automation maintenance updated")
              }
              go={go}
            />
          )}
          {error && (
            <div className="error-banner" role="alert">
              <CircleDot size={18} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {page === "intake" && (
            <Intake
              recording={data.recording}
              state={data}
              status={data.intakeStatus}
              agent={data.agentConnection}
              action={(path, body) =>
                mutate(path, body, "Automation workflow updated")
              }
              go={go}
            />
          )}
          {page === "planning" && (
            <PlanningScreen
              value={data.planning}
              save={(planning) =>
                mutate("planning", { planning }, "Planning intake saved")
              }
            />
          )}
          {page === "design" && (
            <CoverageLab
              value={data.testDesign}
              save={(design, baseDesign) =>
                mutate(
                  "test-design",
                  { design, baseDesign },
                  "Coverage design saved",
                )
              }
            />
          )}
          {page === "environments" && (
            <Environments
              project={p}
              authSessions={data.authSessions}
              signIn={data.signIn}
              action={(path, body) =>
                mutate(path, body, "Sign-in session updated")
              }
              save={(value) =>
                mutate("environments", value, "Environment setup saved")
              }
            />
          )}
          {page === "automate" && (
            <Automate
              project={p}
              runs={data.runs}
              sample={data.sample}
              save={(test) =>
                mutate("quick-test", { test }, "Functional test created")
              }
              run={(input) => mutate("runs", input, "Test started")}
              openTest={(id) => edited(p.tests.find((t) => t.id === id))}
              setup={() => setModal("setup")}
              addExpectation={() => setModal("requirement")}
            />
          )}
          {page === "overview" && (
            <>
              {header(
                "YOUR QUALITY WORKSPACE",
                "A little less effort. A lot more confidence.",
                "Design thoughtful tests. Automate with context. Keep every change covered.",
                <>
                  <Button onClick={() => setModal("compare")}>
                    <GitCompareArrows size={16} /> Compare changes
                  </Button>
                  <Button kind="primary" onClick={() => edited()}>
                    <Plus size={17} /> Create a test
                  </Button>
                </>,
              )}
              <div className="workspace-label">
                <Badge tone="blue">
                  <Layers3 size={12} />
                  {data.sample ? "Interactive sample project" : "Local project"}
                </Badge>
                <span>{p.name}</span>
                <span className="dot-separator">·</span>
                <GitBranch size={13} />
                <span>
                  {data.connections.repository
                    ? "Repository configured · access not verified"
                    : "No live repository connected"}
                </span>
              </div>
              {pending.length > 0 && (
                <div className="change-banner">
                  <div className="banner-symbol">
                    <GitCompareArrows size={22} />
                  </div>
                  <div>
                    <strong>
                      Your application changed. Let’s keep your tests in step.
                    </strong>
                    <p>
                      <b>{pending.length} tests need review.</b> See what
                      changed, compare suggested updates, and stay in control.
                    </p>
                  </div>
                  <Button onClick={() => go("maintenance")}>
                    Review changes <ArrowRight size={16} />
                  </Button>
                </div>
              )}
              {!!data.sourceAlerts?.length && (
                <div className="notice amber">
                  <GitBranch size={18} />
                  <span>
                    {data.sourceAlerts.length} changed source files have no
                    requirement mapping. Their test impact is unknown.
                  </span>
                  <button onClick={() => go("connections")}>
                    Review source scope <ArrowRight size={14} />
                  </button>
                </div>
              )}
              <div className="metric-grid">
                {[
                  {
                    label: "Requirements covered",
                    value: pct(data.coverage.riskWeightedAutomation),
                    hint: "Risk-weighted automation coverage",
                    icon: Target,
                    tone: "blue",
                    to: "coverage",
                  },
                  {
                    label: "Tests in your library",
                    value: p.tests.length,
                    hint: `${ready} automated · ${p.tests.length - ready} need work`,
                    icon: ListChecks,
                    tone: "purple",
                    to: "tests",
                  },
                  {
                    label: "Waiting for review",
                    value: pending.length,
                    hint: pending.length
                      ? "Application changes affect existing tests"
                      : "Your change inbox is clear",
                    icon: GitCompareArrows,
                    tone: "amber",
                    to: "maintenance",
                  },
                  {
                    label: "Latest run",
                    value: latest
                      ? `${latest.summary.passed}/${latest.summary.total}`
                      : "Not run yet",
                    hint: latest
                      ? "Passing checks in the latest run"
                      : "Run a suite when your tests are ready",
                    icon: Activity,
                    tone: "green",
                    to: "runs",
                  },
                ].map((m) => (
                  <button
                    key={m.label}
                    className="metric"
                    onClick={() => go(m.to)}
                  >
                    <div>
                      <span>{m.label}</span>
                      <strong>{m.value}</strong>
                      <small>{m.hint}</small>
                    </div>
                    <span className={`metric-icon ${m.tone}`}>
                      <m.icon size={20} />
                    </span>
                  </button>
                ))}
              </div>
              <div className="card journey-card">
                <div className="section-heading">
                  <div>
                    <h2>Your path to reliable automation</h2>
                    <p>
                      One connected workflow, from the first requirement to the
                      next release.
                    </p>
                  </div>
                  <Badge>STEP BY STEP</Badge>
                </div>
                <div className="journey">
                  {[
                    {
                      title: "Set the context",
                      text: "Application, sources & environments",
                      icon: Link2,
                      to: "connections",
                      state: !!data.connections.repository,
                    },
                    {
                      title: "Design your tests",
                      text: "Requirements & expected behavior",
                      icon: FileText,
                      to: "requirements",
                      state: p.requirements.length > 0,
                    },
                    {
                      title: "Build automation",
                      text: "Reusable steps & clear assertions",
                      icon: Workflow,
                      to: "tests",
                      state: ready === p.tests.length,
                    },
                    {
                      title: "Run & understand",
                      text: "Browsers, suites & actionable reports",
                      icon: Play,
                      to: "runs",
                      state: !!latest,
                    },
                    {
                      title: "Keep it current",
                      text: "Review changes with evidence",
                      icon: GitCompareArrows,
                      to: "maintenance",
                      state: pending.length === 0,
                    },
                  ].map((s, i) => (
                    <button
                      onClick={() => go(s.to)}
                      key={s.title}
                      className={s.state ? "done" : ""}
                    >
                      <span className="journey-icon">
                        {s.state ? <Check size={20} /> : <s.icon size={20} />}
                      </span>
                      <small>0{i + 1}</small>
                      <b>{s.title}</b>
                      <span>{s.text}</span>
                      <ArrowRight className="journey-arrow" size={16} />
                    </button>
                  ))}
                </div>
              </div>
              <div className="two-columns">
                <section className="card focus-card">
                  <div className="section-heading">
                    <h2>Make your next move count</h2>
                    <Badge tone="purple">
                      <Sparkles size={12} /> Guided actions
                    </Badge>
                  </div>
                  {[
                    {
                      icon: GitCompareArrows,
                      title: pending.length
                        ? `Review ${pending.length} affected tests`
                        : "Compare your next application change",
                      description: pending.length
                        ? "Checkout behavior changed. Review validations, locators and the user journey."
                        : "Bring in an updated project definition to identify impact.",
                      to: "maintenance",
                      color: "amber",
                    },
                    {
                      icon: Target,
                      title: "Close the gaps in your coverage",
                      description: `${data.coverage.rows.filter((r) => r.gaps.length).length} requirements have review or automation gaps.`,
                      to: "coverage",
                      color: "blue",
                    },
                    {
                      icon: FlaskConical,
                      title: "Turn a manual case into automation",
                      description:
                        "Start with the expected outcome. Reuse a step from your catalog.",
                      to: "tests",
                      color: "purple",
                    },
                  ].map((action) => (
                    <button
                      className="action-row"
                      onClick={() => go(action.to)}
                      key={action.title}
                    >
                      <span className={`action-icon ${action.color}`}>
                        <action.icon size={19} />
                      </span>
                      <div>
                        <strong>{action.title}</strong>
                        <p>{action.description}</p>
                      </div>
                      <ChevronRight size={18} />
                    </button>
                  ))}
                </section>
                <section className="card activity-card">
                  <div className="section-heading">
                    <h2>Workspace activity</h2>
                    <button
                      className="icon-button"
                      aria-label="Project version history"
                      onClick={() => setModal("history")}
                    >
                      <Clock3 size={17} />
                    </button>
                  </div>
                  {data.activities.length ? (
                    data.activities.slice(0, 4).map((a) => (
                      <div className="activity-item" key={a.id}>
                        <span className="timeline-dot" />
                        <div>
                          <strong>{a.title}</strong>
                          <p>{a.detail}</p>
                          <small>{new Date(a.at).toLocaleString()}</small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <>
                      <div className="activity-item">
                        <span className="timeline-dot" />
                        <div>
                          <strong>Your workspace is ready to explore</strong>
                          <p>
                            The sample includes requirements, runnable API and
                            browser tests, and a feature change to review.
                          </p>
                          <small>Start with the guided workflow</small>
                        </div>
                      </div>
                      <div className="quiet-note">
                        <ShieldCheck size={17} />
                        <p>
                          Suggestions are reviewable drafts. You decide when a
                          test is ready.
                        </p>
                      </div>
                    </>
                  )}
                </section>
              </div>
            </>
          )}
          {page === "tests" && (
            <>
              {header(
                "DESIGN & BUILD",
                "A test library that understands your application.",
                "Keep intent, evidence, steps and validations together.",
                <>
                  <Button onClick={() => setModal("ai")}>
                    <Sparkles size={16} /> Draft with local AI
                  </Button>
                  <Button kind="primary" onClick={() => edited()}>
                    <Plus size={17} /> Create a test
                  </Button>
                </>,
              )}
              <div className="card">
                <div className="toolbar">
                  <div className="search-field">
                    <Search size={17} />
                    <input
                      aria-label="Search tests"
                      placeholder="Search by test, feature or tag…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <select
                    aria-label="Filter tests by status"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">All statuses</option>
                    {[
                      "Needs review",
                      "Ready for review",
                      "Reviewed",
                      "Draft",
                      "Blocked",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <span className="muted">{visibleTests.length} tests</span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Test case</th>
                        <th>Coverage</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleTests.map((t) => (
                        <tr key={t.id}>
                          <td>
                            <button
                              className="test-link"
                              onClick={() => edited(t)}
                            >
                              <span className="test-id">{t.id}</span>
                              <strong>{t.title}</strong>
                            </button>
                          </td>
                          <td>
                            <span className="small-code">
                              {t.requirementIds.join(", ")}
                            </span>
                            <small>
                              {Object.values(t.covers).flat().length} acceptance
                              criteria
                            </small>
                          </td>
                          <td>
                            <Badge>
                              {t.steps.some(
                                (s) =>
                                  p.catalog.find((a) => a.id === s.action)
                                    ?.kind === "web",
                              )
                                ? "Browser"
                                : "API"}
                            </Badge>
                          </td>
                          <td>
                            <Badge
                              tone={
                                status(t) === "Needs review"
                                  ? "amber"
                                  : status(t) === "Blocked"
                                    ? "red"
                                    : status(t) === "Reviewed"
                                      ? "green"
                                      : "neutral"
                              }
                            >
                              {status(t)}
                            </Badge>
                          </td>
                          <td>
                            <button
                              className="icon-button"
                              aria-label={`Edit ${t.id}`}
                              onClick={() => edited(t)}
                            >
                              <ChevronRight size={18} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!visibleTests.length && (
                  <Empty
                    icon={Search}
                    title="No tests match"
                    body="Try another feature, tag or status."
                  />
                )}
              </div>
            </>
          )}
          {page === "maintenance" && (
            <>
              {header(
                "KEEP IT RELIABLE",
                "Every change, understood.",
                "Know which tests are affected—and exactly what needs your attention.",
                <>
                  <Button
                    disabled={loading || !data.connections.localRepository}
                    onClick={() =>
                      void mutate("scan", {}, "Source check completed")
                    }
                  >
                    <GitBranch size={16} /> Check source
                  </Button>
                  {pending.length > 1 && (
                    <Button onClick={() => setModal("stage-all")}>
                      <Check size={16} /> Stage all as drafts
                    </Button>
                  )}
                  <Button kind="primary" onClick={() => setModal("compare")}>
                    <GitCompareArrows size={16} /> Compare versions
                  </Button>
                </>,
              )}
              <div className="maintenance-summary">
                <Badge tone="amber">
                  <CircleDot size={12} />
                  {pending.length} need review
                </Badge>
                <Badge tone="blue">{staged.length} staged as drafts</Badge>
                <span>
                  {data.plan?.source === "sample"
                    ? "Example feature change · supplied sample specification"
                    : data.plan?.source === "source-scan"
                      ? "Read-only source comparison"
                      : "Version comparison"}{" "}
                  · {data.plan?.title ?? "No active comparison"}
                </span>
              </div>
              {data.plan && data.plan.items.length > 0 ? (
                <div className="review-layout">
                  <aside className="card review-list">
                    <div className="review-list-title">
                      <h3>Affected tests</h3>
                      <span>{data.plan.items.length}</span>
                    </div>
                    {data.plan.items.map((item) => (
                      <button
                        key={item.id}
                        className={
                          currentItem?.id === item.id ? "selected" : ""
                        }
                        onClick={() => setSelectedChange(item.id)}
                      >
                        <span
                          className={`review-type ${item.status === "staged" ? "green" : "amber"}`}
                        >
                          {item.status === "staged" ? (
                            <Check size={16} />
                          ) : (
                            <FileCheck2 size={16} />
                          )}
                        </span>
                        <div>
                          <small>{item.testId}</small>
                          <strong>{item.title}</strong>
                          <span>
                            {data.plan?.source === "source-scan"
                              ? "Source interpretation required"
                              : item.changes.length
                                ? `${item.changes.length} proposed differences`
                                : "Interpretation required"}
                          </span>
                        </div>
                        <ChevronRight size={15} />
                      </button>
                    ))}
                  </aside>
                  {currentItem && (
                    <section className="card review-detail">
                      <div className="review-detail-heading">
                        <div>
                          <span className="eyebrow">
                            {currentItem.testId} · CHANGE REVIEW
                          </span>
                          <h2>{currentItem.title}</h2>
                        </div>
                        <Badge
                          tone={
                            currentItem.status === "staged" ? "blue" : "amber"
                          }
                        >
                          {currentItem.status === "staged"
                            ? "Staged · needs validation"
                            : "Needs review"}
                        </Badge>
                      </div>
                      <div className="reason-box">
                        <GitCompareArrows size={19} />
                        <div>
                          <strong>Why this test is affected</strong>
                          {currentItem.reasons.map((r) => (
                            <p key={r}>{r}</p>
                          ))}
                        </div>
                      </div>
                      <div className="review-section-title">
                        <h3>
                          {data.plan.source === "source-scan"
                            ? "Source differences to interpret"
                            : "Suggested updates"}
                        </h3>
                        <span>Based on the supplied source comparison</span>
                      </div>
                      {currentItem.changes.length ? (
                        currentItem.changes.map((change, i) => (
                          <div className="diff-card" key={i}>
                            <div className="diff-heading">
                              <Badge
                                tone={
                                  change.kind === "UI"
                                    ? "purple"
                                    : change.kind === "Validation"
                                      ? "blue"
                                      : "neutral"
                                }
                              >
                                {change.kind}
                              </Badge>
                              <strong>{change.label}</strong>
                            </div>
                            <div className="diff-columns">
                              <div className="diff-before">
                                <span>BEFORE</span>
                                <pre>{change.before || "Not defined"}</pre>
                              </div>
                              <div className="diff-after">
                                <span>PROPOSED</span>
                                <pre>{change.after || "Not defined"}</pre>
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <Empty
                          icon={BookOpen}
                          title="Review the new behavior first"
                          body="A source or dependency changed, but no supported executable update was supplied. Read the evidence and design the expected behavior."
                        />
                      )}
                      <details className="evidence-details">
                        <summary>
                          <Code2 size={16} /> Inspect the full proposed test{" "}
                          <ChevronDown size={16} />
                        </summary>
                        <pre>{pretty(currentItem.candidate)}</pre>
                      </details>
                      <details className="evidence-details">
                        <summary>
                          <FileText size={16} /> View supporting evidence{" "}
                          <ChevronDown size={16} />
                        </summary>
                        {data.plan.candidate.evidence
                          .filter((e) =>
                            currentItem.candidate.evidenceIds.includes(e.id),
                          )
                          .map((e) => (
                            <div key={e.id}>
                              <b>
                                {e.source} <Badge>{e.revision}</Badge>
                              </b>
                              <p>{e.excerpt}</p>
                            </div>
                          ))}
                      </details>
                      <div className="review-footer">
                        <p>
                          <ShieldCheck size={16} /> Staging resets affected
                          tests to draft. Review and a fresh run still follow.
                        </p>
                        <div>
                          {currentItem.status === "pending" && (
                            <Button
                              onClick={() => {
                                setResolution("");
                                setModal("resolve");
                              }}
                            >
                              Use my edited test
                            </Button>
                          )}
                          <Button
                            onClick={() =>
                              edited(
                                p.tests.find(
                                  (t) => t.id === currentItem.testId,
                                ),
                              )
                            }
                          >
                            <Code2 size={16} /> Open test
                          </Button>
                          <Button
                            kind="primary"
                            disabled={
                              loading || currentItem.status === "staged"
                            }
                            onClick={() => setModal("stage")}
                          >
                            {currentItem.status === "staged" ? (
                              <>
                                <Check size={16} /> Staged
                              </>
                            ) : (
                              <>
                                Stage suggested updates <ArrowRight size={16} />
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </section>
                  )}
                </div>
              ) : (
                <div className="card">
                  <Empty
                    icon={CheckCircle2}
                    title={
                      data.plan &&
                      !data.plan.sourceStaged &&
                      (data.plan.changedRequirements.length > 0 ||
                        data.plan.candidate.tests.some(
                          (t) => !p.tests.some((old) => old.id === t.id),
                        ))
                        ? "New behavior needs test design"
                        : "Your change inbox is clear"
                    }
                    body="Compare an updated project definition or connect an allowlisted local repository to detect affected tests."
                  >
                    {data.plan &&
                    !data.plan.sourceStaged &&
                    (data.plan.changedRequirements.length > 0 ||
                      data.plan.candidate.tests.some(
                        (t) => !p.tests.some((old) => old.id === t.id),
                      )) ? (
                      <Button onClick={() => setModal("stage-source")}>
                        Review and stage new sources <ArrowRight size={16} />
                      </Button>
                    ) : (
                      <Button onClick={() => setModal("compare")}>
                        Compare versions <ArrowRight size={16} />
                      </Button>
                    )}
                  </Empty>
                </div>
              )}
              <div className="maintenance-bottom">
                <ShieldCheck size={18} />
                <div>
                  <strong>Change-aware, never change-blind.</strong>
                  <span>
                    {" "}
                    New requirements become visible coverage gaps. Expected
                    results are never weakened automatically.
                  </span>
                </div>
              </div>
            </>
          )}
          {page === "requirements" && (
            <>
              {header(
                "START WITH INTENT",
                "Define what good looks like.",
                "Turn business expectations into traceable acceptance criteria and tests.",
                <Button kind="primary" onClick={() => setModal("requirement")}>
                  <Plus size={17} /> Add a requirement
                </Button>,
              )}
              <div className="requirements-grid">
                {p.requirements.map((r) => {
                  const linked = p.tests.filter((t) =>
                      t.requirementIds.includes(r.id),
                    ),
                    row = data.coverage.rows.find(
                      (c) => c.requirementId === r.id,
                    )!;
                  return (
                    <article className="card requirement" key={r.id}>
                      <div className="section-heading">
                        <span className="small-code">{r.id}</span>
                        <Badge
                          tone={
                            r.risk === "critical"
                              ? "red"
                              : r.risk === "high"
                                ? "amber"
                                : "neutral"
                          }
                        >
                          {r.risk} risk
                        </Badge>
                      </div>
                      <h2>{r.title}</h2>
                      <div className="criteria-list">
                        {r.criteria.map((c) => (
                          <div key={c.id}>
                            <CircleDot size={15} />
                            <span>{c.title}</span>
                          </div>
                        ))}
                      </div>
                      <div className="requirement-bottom">
                        <span>
                          <ListChecks size={15} />
                          {linked.length} tests · {r.criteria.length} criteria
                        </span>
                        <Button
                          onClick={() => {
                            go("tests", r.id);
                          }}
                        >
                          View tests <ArrowRight size={15} />
                        </Button>
                      </div>
                      {row.gaps.length > 0 && (
                        <div className="inline-hint">
                          <Target size={14} />
                          {row.gaps.includes("uncovered-acceptance-criteria")
                            ? "New acceptance criteria need automation"
                            : row.gaps.includes("missing-asserted-automation")
                              ? "Automation needed"
                              : "Human review still needed"}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </>
          )}
          {page === "coverage" && (
            <>
              {header(
                "SEE THE WHOLE PICTURE",
                "Coverage with context.",
                "Trace each requirement to reviewed tests and execution evidence.",
                <Download name="superq-coverage.json" value={data.coverage} />,
              )}
              <div className="coverage-hero card">
                <div>
                  <span className="eyebrow">RISK-WEIGHTED AUTOMATION</span>
                  <h2>{pct(data.coverage.riskWeightedAutomation)}</h2>
                  <p>
                    Declared requirements with assertion-bearing automation.
                  </p>
                </div>
                <div className="coverage-legend">
                  <span>
                    <i className="legend-blue" />
                    Automation coverage
                  </span>
                  <strong>
                    {pct(data.coverage.riskWeightedProven)} reviewed & proven
                  </strong>
                  <small>
                    Scope: declared requirements and acceptance criteria.
                    <br />
                    Passing checks do not prove application completeness.
                  </small>
                </div>
              </div>
              <div className="card">
                <div className="section-heading">
                  <h2>Requirement-to-test map</h2>
                  <Badge>{p.requirements.length} requirements</Badge>
                </div>
                {data.coverage.rows.map((row) => (
                  <div className="coverage-row" key={row.requirementId}>
                    <div className="coverage-name">
                      <span className="small-code">{row.requirementId}</span>
                      <strong>
                        {
                          p.requirements.find((r) => r.id === row.requirementId)
                            ?.title
                        }
                      </strong>
                      <Badge tone={row.risk === "critical" ? "red" : "neutral"}>
                        {row.risk}
                      </Badge>
                    </div>
                    <div className="coverage-tags">
                      {row.tests.map((id) => (
                        <button
                          key={id}
                          onClick={() =>
                            edited(p.tests.find((t) => t.id === id))
                          }
                        >
                          {id}
                          <ChevronRight size={12} />
                        </button>
                      ))}
                      {!row.tests.length && <span>No linked tests</span>}
                    </div>
                    <div className="coverage-gaps">
                      {row.criteria
                        .filter((c) => !c.automated.length)
                        .map((c) => (
                          <span key={c.id}>
                            <CircleDot size={13} />
                            {c.title} — needs automation
                          </span>
                        ))}
                      {row.gaps.includes("missing-qe-review") && (
                        <span>
                          <Clock3 size={13} /> Review pending
                        </span>
                      )}
                      {row.gaps.includes("blocker") && (
                        <span>
                          <CircleDot size={13} /> Blocker recorded
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {page === "catalog" && (
            <>
              {header(
                "REUSE WHAT WORKS",
                "Build once. Automate consistently.",
                "A shared home for actions and locators that keeps your tests maintainable.",
                <Download
                  name="superq-catalog.json"
                  value={{ catalog: p.catalog, locators: p.locators }}
                />,
              )}
              <div className="card">
                <div className="section-heading">
                  <h2>Reusable actions</h2>
                  <Badge>{p.catalog.length} actions</Badge>
                </div>
                {p.catalog.map((a) => (
                  <div className="catalog-row" key={a.id}>
                    <span className="action-icon blue">
                      {a.kind === "web" ? (
                        <Globe2 size={20} />
                      ) : (
                        <Braces size={20} />
                      )}
                    </span>
                    <div>
                      <strong>{a.id}</strong>
                      <p>{a.description}</p>
                    </div>
                    <Badge>{a.kind}</Badge>
                    <span className="muted">
                      Used by{" "}
                      {
                        p.tests.filter((t) =>
                          t.steps.some((s) => s.action === a.id),
                        ).length
                      }{" "}
                      tests
                    </span>
                  </div>
                ))}
              </div>
              <div className="card spaced">
                <div className="section-heading">
                  <h2>Shared locators</h2>
                  <span className="muted">
                    Edit through a comparison so affected tests get reviewed.
                  </span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Locator</th>
                        <th>Strategy</th>
                        <th>Value</th>
                        <th>Usage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(p.locators).map(([id, l]) => (
                        <tr key={id}>
                          <td>
                            <code>{id}</code>
                          </td>
                          <td>{l.strategy}</td>
                          <td>
                            <code>{l.value}</code>
                          </td>
                          <td>
                            {
                              p.tests.filter((t) =>
                                t.steps.some((s) =>
                                  JSON.stringify(s.input).includes(
                                    JSON.stringify(id),
                                  ),
                                ),
                              ).length
                            }{" "}
                            tests
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
          {page === "runs" && (
            <>
              {header(
                "RUN & UNDERSTAND",
                "Less noise. Clearer results.",
                "Run a suite on your chosen browser and follow every result back to its test.",
                <Button
                  kind="primary"
                  disabled={
                    loading || data.runs.some((r) => r.state === "running")
                  }
                  onClick={() => setModal("run")}
                >
                  <Play size={16} /> Run a suite
                </Button>,
              )}
              {pending.length > 0 && (
                <div className="notice">
                  <GitCompareArrows size={19} />
                  <span>
                    Resolve {pending.length} pending maintenance reviews before
                    starting another run.
                  </span>
                  <button onClick={() => go("maintenance")}>
                    Open change inbox <ArrowRight size={14} />
                  </button>
                </div>
              )}
              <div className="card">
                {!data.runs.length ? (
                  <Empty
                    icon={Play}
                    title="Your first run starts here"
                    body="Choose an environment, suite and browser. SuperQ will preserve blockers, failures and every attempt."
                  >
                    <Button onClick={() => setModal("run")}>
                      Configure a run <ArrowRight size={16} />
                    </Button>
                  </Empty>
                ) : (
                  data.runs.map((r) => (
                    <div className="run-row" key={r.id}>
                      <span
                        className={`run-state ${r.state === "running" ? "blue" : r.report?.gates.length ? "amber" : "green"}`}
                      >
                        {r.state === "running" ? (
                          <Loader2 className="spin" size={21} />
                        ) : (
                          <FileCheck2 size={21} />
                        )}
                      </span>
                      <div>
                        <strong>
                          {r.draftValidation
                            ? "Draft validation"
                            : (r.report?.suite ?? "Suite execution")}{" "}
                          <Badge
                            tone={
                              r.state === "running"
                                ? "blue"
                                : r.state === "failed"
                                  ? "red"
                                  : "neutral"
                            }
                          >
                            {r.state}
                          </Badge>
                        </strong>
                        <p>
                          {r.report
                            ? `${r.report.environment} · ${r.report.runs[0]?.browser} · ${r.report.summary.passed}/${r.report.summary.total} passed`
                            : (r.error ?? "Running with isolated contexts…")}
                        </p>
                        <small>{new Date(r.at).toLocaleString()}</small>
                      </div>
                      {r.traceWarnings?.map((w) => (
                        <p key={w}>{w}</p>
                      ))}
                      {!!r.traces?.length && (
                        <div>
                          <small>
                            Private traces · expire after 24 hours · may contain
                            secrets
                          </small>
                          {r.traces.map((t) => (
                            <div key={t.id}>
                              <button
                                className="button"
                                onClick={() =>
                                  void downloadTrace(t.id, data.token).catch(
                                    (e) => setError(String(e.message)),
                                  )
                                }
                              >
                                {t.testId} · attempt {t.attempt} · Download
                                trace
                              </button>
                              <button
                                className="button"
                                onClick={() =>
                                  void mutate(
                                    "traces/delete",
                                    { id: t.id },
                                    "Private trace deleted",
                                  )
                                }
                              >
                                Delete trace
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {r.report && (
                        <a
                          className="button secondary"
                          href={`/api/reports/${r.id}/html`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open report <ArrowRight size={16} />
                        </a>
                      )}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
          {page === "release" && (
            <>
              {header(
                "SHIP WITH EVIDENCE",
                "Confidence is earned, not assumed.",
                "Bring together test coverage, release identity and independent approvals.",
                <Download
                  name="superq-readiness-gaps.json"
                  value={data.audit}
                />,
              )}
              <div className="readiness-banner">
                <ShieldCheck size={30} />
                <div>
                  <Badge tone="amber">Not assessed for production</Badge>
                  <h2>Your release evidence has work to do.</h2>
                  <p>
                    This workspace helps you prepare. Production promotion
                    requires the exact artifact, complete evidence and
                    independent approval.
                  </p>
                </div>
              </div>
              <div className="card">
                <div className="section-heading">
                  <h2>Readiness checklist</h2>
                  <Badge>{data.audit.summary.high} high-priority gaps</Badge>
                </div>
                {[
                  {
                    title: "Reviewed requirements and acceptance criteria",
                    done: p.requirements.every((r) => r.criteria.length),
                    text: "Every expected behavior needs an explicit, traceable criterion.",
                  },
                  {
                    title: "Current human test reviews",
                    done: !data.audit.findings.some(
                      (f) => f.id === "review-integrity",
                    ),
                    text: "Review must still match the current test and source evidence.",
                  },
                  {
                    title: "Complete clean suite and browser evidence",
                    done: false,
                    text: "Supply complete, fresh reports for the required release matrix.",
                  },
                  {
                    title: "Immutable build and promotion policy",
                    done: !!p.release,
                    text: "Bind evidence to the exact application SHA and artifact digest.",
                  },
                  {
                    title: "Independent operational checks and approvals",
                    done: false,
                    text: "Security, performance, rollback and observability checks; separate release approvals.",
                  },
                ].map((c) => (
                  <div className="checklist-row" key={c.title}>
                    {c.done ? (
                      <CheckCircle2 className="green-text" size={21} />
                    ) : (
                      <Circle className="muted" size={21} />
                    )}
                    <div>
                      <strong>{c.title}</strong>
                      <p>{c.text}</p>
                    </div>
                    <Badge tone={c.done ? "green" : "amber"}>
                      {c.done ? "Configured" : "Needs evidence"}
                    </Badge>
                  </div>
                ))}
              </div>
              <div className="terminal-note">
                <Terminal size={19} />
                <div>
                  <strong>
                    Use the promotion assessment in your protected pipeline
                  </strong>
                  <code>
                    npm run superq -- promote project.json release-manifest.json
                  </code>
                  <p>
                    A successful assessment is eligible for human review. It
                    does not deploy or certify an application.
                  </p>
                </div>
              </div>
            </>
          )}
          {page === "connections" && (
            <>
              {header(
                "SET THE CONTEXT",
                "A good start makes every step easier.",
                "Configure your application, evidence sources and read-only maintenance checks.",
                <Button kind="primary" onClick={() => setModal("setup")}>
                  <Settings2 size={16} /> Configure workspace
                </Button>,
              )}
              <div className="connections-grid">
                {[
                  {
                    icon: Globe2,
                    title: "Application & environments",
                    value: Object.entries(p.environments)
                      .map(([key, e]) => `${key}: ${e.baseURL}`)
                      .join("\n"),
                    status: "Configured",
                    tone: "blue",
                  },
                  {
                    icon: GitBranch,
                    title: "Application repository",
                    value:
                      data.connections.repository ||
                      "Add the application repository URL for context.",
                    status: data.connections.repository
                      ? "Configured · access unverified"
                      : "Not configured",
                    tone: "neutral",
                  },
                  {
                    icon: FileText,
                    title: "Stories & test management",
                    value:
                      data.connections.tracker ||
                      "Record your Jira or Azure DevOps project URL.",
                    status: data.connections.tracker
                      ? "Configured · access unverified"
                      : "Not configured",
                    tone: "neutral",
                  },
                  {
                    icon: BookOpen,
                    title: "Documentation",
                    value:
                      data.connections.documentation ||
                      "Link the specifications that define expected behavior.",
                    status: data.connections.documentation
                      ? "Reference saved"
                      : "Not configured",
                    tone: "neutral",
                  },
                ].map((c) => (
                  <div className="card connection" key={c.title}>
                    <span className={`metric-icon ${c.tone}`}>
                      <c.icon size={22} />
                    </span>
                    <h2>{c.title}</h2>
                    <p>{c.value}</p>
                    <Badge tone={c.tone}>{c.status}</Badge>
                  </div>
                ))}
              </div>
              <div className="card spaced">
                <div className="section-heading">
                  <div>
                    <h2>Read-only change monitoring</h2>
                    <p>
                      Local Git snapshots use only your explicit source path
                      allowlist.
                    </p>
                  </div>
                  <Badge tone={data.connections.watch ? "green" : "neutral"}>
                    {data.connections.watch
                      ? "Checks every 30 seconds"
                      : "Manual checks"}
                  </Badge>
                </div>
                <div className="monitor-details">
                  <div>
                    <small>Local repository</small>
                    <code>
                      {data.connections.localRepository || "Not configured"}
                    </code>
                  </div>
                  <div>
                    <small>Files in scope</small>
                    <code>
                      {data.connections.paths.join(", ") || "No paths selected"}
                    </code>
                  </div>
                  <div>
                    <small>Last checked</small>
                    <span>
                      {data.connections.lastChecked
                        ? new Date(
                            data.connections.lastChecked,
                          ).toLocaleString()
                        : "Not yet checked"}
                    </span>
                  </div>
                </div>
                {!!data.sourceAlerts?.length && (
                  <div className="notice amber">
                    <FileText size={18} />
                    <span>
                      Unmapped changed files:{" "}
                      {data.sourceAlerts.map((s) => s.path).join(", ")}. Add
                      their exact paths as requirement evidence before claiming
                      coverage.
                    </span>
                  </div>
                )}
                {data.connections.lastError && (
                  <p className="red-text">{data.connections.lastError}</p>
                )}
                <Button
                  disabled={!data.connections.localRepository || loading}
                  onClick={() =>
                    void mutate("scan", {}, "Source check completed")
                  }
                >
                  <GitBranch size={16} /> Check for changes now
                </Button>
              </div>
              {data.sample && (
                <div className="card spaced">
                  <div className="section-heading">
                    <div>
                      <h2>Built-in sample application</h2>
                      <p>
                        Switch sample versions to exercise the maintenance
                        workflow. No external application is deployed.
                      </p>
                    </div>
                    <Badge tone="blue">Version {data.sampleVersion ?? 1}</Badge>
                  </div>
                  <Button
                    disabled={loading}
                    onClick={() =>
                      void mutate(
                        "sample-version",
                        { version: data.sampleVersion === 2 ? 1 : 2 },
                        "Built-in sample application version changed",
                      )
                    }
                  >
                    Switch sample to version {data.sampleVersion === 2 ? 1 : 2}
                  </Button>
                </div>
              )}
              <div className="card spaced">
                <div className="section-heading">
                  <div>
                    <h2>Browser profiles & execution</h2>
                    <p>
                      Reuse local engines or explicit cloud profiles from your
                      project configuration.
                    </p>
                  </div>
                  <Button onClick={() => setModal("project")}>
                    <Code2 size={16} /> Project configuration
                  </Button>
                </div>
                <div className="browser-profiles">
                  {Object.entries(p.browsers).map(([id, b]) => (
                    <div key={id}>
                      <Globe2 size={19} />
                      <strong>{id}</strong>
                      <Badge>{b.browser}</Badge>
                      <small>{b.provider}</small>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </main>
        <footer className="workspace-footer">
          <span>
            <ShieldCheck size={14} /> Evidence-led. Human-reviewed. Always
            traceable.
          </span>
          <span>
            SuperQ Studio <span> / </span> Local workspace
          </span>
        </footer>
      </div>
      {modal && error && (
        <div className="toast error-toast" role="alert">
          <CircleDot size={18} />
          {error}
          <button onClick={() => setError("")} aria-label="Dismiss error">
            <X size={16} />
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {modal === "guide" && (
        <Modal
          title="Your automation guide"
          subtitle="A clear next step, wherever you are in the journey."
          onClose={() => setModal(null)}
        >
          <div className="guide-list">
            {[
              {
                title: "1. Connect the context",
                body: "Configure the application and add approved source evidence. Repository and tracker URLs are references until access is verified.",
              },
              {
                title: "2. Define the behavior",
                body: "Break requirements into acceptance criteria, including negative and recovery paths.",
              },
              {
                title: "3. Build a readable test",
                body: "Choose reusable actions, configure inputs, and add explicit independent assertions.",
              },
              {
                title: "4. Review, then run",
                body: "Record a named human review. Choose environment, suite and browser; inspect blockers and failures.",
              },
              {
                title: "5. Keep tests current",
                body: "Compare source versions. Review before/after suggestions, stage drafts, close new coverage gaps and run again.",
              },
            ].map((g) => (
              <div key={g.title}>
                <h3>{g.title}</h3>
                <p>{g.body}</p>
              </div>
            ))}
          </div>
          <div className="modal-footer">
            <Button
              kind="primary"
              onClick={() => {
                setModal(null);
                go("connections");
              }}
            >
              Start with setup <ArrowRight size={16} />
            </Button>
          </div>
        </Modal>
      )}
      {modal === "setup" && (
        <SetupDialog
          data={data}
          loading={loading}
          onClose={() => setModal(null)}
          onSave={async (value) => {
            if (await mutate("setup", value, "Workspace configuration saved"))
              setModal(null);
          }}
        />
      )}
      {modal === "test" && (
        <TestDialog
          project={p}
          test={selectedTest}
          pending={pending.some((i) => i.testId === selectedTest?.id)}
          loading={loading}
          onClose={() => setModal(null)}
          onSave={async (test) => {
            const next = structuredClone(p),
              index = next.tests.findIndex((t) => t.id === test.id);
            if (index >= 0) next.tests[index] = test;
            else next.tests.push(test);
            if (
              await mutate(
                "project",
                { project: next },
                "Test saved as a draft",
              )
            )
              setModal(null);
          }}
          onApprove={async (reviewer) => {
            if (
              await mutate(
                "approve",
                { testId: selectedTest?.id, reviewer },
                "Human review recorded",
              )
            )
              setModal(null);
          }}
        />
      )}
      {modal === "requirement" && (
        <RequirementDialog
          project={p}
          loading={loading}
          onClose={() => setModal(null)}
          onSave={async (project) => {
            if (
              await mutate(
                "project",
                { project },
                "Requirement and evidence saved",
              )
            )
              setModal(null);
          }}
        />
      )}
      {modal === "compare" && (
        <CompareDialog
          data={data}
          loading={loading}
          onClose={() => setModal(null)}
          onCompare={async (candidate) => {
            if (
              await mutate(
                "compare",
                {
                  candidate,
                  title: "Application specification updated",
                  replace: true,
                },
                "Change comparison is ready",
              )
            ) {
              setModal(null);
              go("maintenance");
            }
          }}
        />
      )}
      {(modal === "stage" || modal === "stage-all") && currentItem && (
        <Modal
          title={
            modal === "stage-all"
              ? `Stage all ${pending.length} affected tests as drafts?`
              : "Stage these updates as a draft?"
          }
          subtitle="Your current tests stay available in project history."
          onClose={() => setModal(null)}
        >
          <div className="modal-body">
            <div className="notice">
              <ShieldCheck size={19} />
              <span>
                Shared source and locator updates also invalidate the other
                affected test reviews. No test is approved automatically.
              </span>
            </div>
            <h3>
              {currentItem.testId} · {currentItem.title}
            </h3>
            <p>
              Next: inspect the updated test, cover any new acceptance criteria,
              validate it, record a human review, then run the reviewed version.
            </p>
          </div>
          <div className="modal-footer">
            <Button onClick={() => setModal(null)}>Keep reviewing</Button>
            <Button
              kind="primary"
              disabled={loading}
              onClick={() =>
                void (async () => {
                  if (
                    await mutate(
                      "stage",
                      {
                        ids:
                          modal === "stage-all"
                            ? pending.map((i) => i.id)
                            : [currentItem.id],
                      },
                      "Updates staged. The affected tests now need review.",
                    )
                  )
                    setModal(null);
                })()
              }
            >
              <Check size={16} /> Stage as draft
            </Button>
          </div>
        </Modal>
      )}
      {modal === "stage-source" && (
        <Modal
          title="Stage new behavior for test design?"
          subtitle="The new requirements will appear in your coverage map."
          onClose={() => setModal(null)}
        >
          <div className="modal-body">
            <p>
              This comparison adds or changes sources without affecting an
              existing test. Staging imports the supplied definitions and keeps
              any new test definitions as drafts. No automation is invented.
            </p>
          </div>
          <div className="modal-footer">
            <Button onClick={() => setModal(null)}>Cancel</Button>
            <Button
              kind="primary"
              disabled={loading}
              onClick={() =>
                void (async () => {
                  if (
                    await mutate(
                      "stage",
                      { ids: [] },
                      "Sources staged. Design tests for the new criteria.",
                    )
                  ) {
                    setModal(null);
                    go("coverage");
                  }
                })()
              }
            >
              Stage source definitions <ArrowRight size={16} />
            </Button>
          </div>
        </Modal>
      )}
      {modal === "resolve" && currentItem && (
        <Modal
          title="Use your current test definition?"
          subtitle="Resolve this proposal without overwriting your manually edited steps."
          onClose={() => setModal(null)}
        >
          <div className="modal-body form-stack">
            <p>
              Shared source and locator updates will still be staged. Your saved
              test steps are preserved, and the test returns to draft for
              validation and human review.
            </p>
            <Field label="Why is the current definition appropriate?">
              <textarea
                rows={3}
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="Explain the manual changes or evidence for keeping the current expectations."
              />
            </Field>
          </div>
          <div className="modal-footer">
            <Button onClick={() => setModal(null)}>Cancel</Button>
            <Button
              kind="primary"
              disabled={loading || resolution.trim().length < 8}
              onClick={() =>
                void (async () => {
                  if (
                    await mutate(
                      "stage",
                      {
                        ids: [currentItem.id],
                        mode: "keep-current",
                        note: resolution,
                      },
                      "Manual resolution saved as a draft",
                    )
                  )
                    setModal(null);
                })()
              }
            >
              Keep current steps as draft
            </Button>
          </div>
        </Modal>
      )}
      {modal === "history" && (
        <Modal
          title="Project version history"
          subtitle="Restore a saved project definition. Source comparisons are re-evaluated afterward."
          onClose={() => setModal(null)}
        >
          <div className="modal-body">
            {data.history.length ? (
              data.history.map((h) => (
                <div className="history-row" key={h.id}>
                  <div>
                    <strong>{h.title}</strong>
                    <small>{new Date(h.at).toLocaleString()}</small>
                  </div>
                  <Button
                    disabled={loading}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Restore this project version? Current state will be kept in history.",
                        )
                      )
                        void (async () => {
                          if (
                            await mutate(
                              "restore",
                              { id: h.id },
                              "Project version restored; source impact rechecked",
                            )
                          )
                            setModal(null);
                        })();
                    }}
                  >
                    Restore version
                  </Button>
                </div>
              ))
            ) : (
              <Empty
                icon={Clock3}
                title="No saved edits yet"
                body="Project edits and maintenance staging create recoverable versions."
              />
            )}
          </div>
          <div className="modal-footer">
            <Button onClick={() => setModal(null)}>Close</Button>
          </div>
        </Modal>
      )}
      {modal === "run" && (
        <RunDialog
          data={data}
          loading={loading}
          pending={pending.length}
          onClose={() => setModal(null)}
          onRun={async (config) => {
            if (await mutate("runs", config, "Suite execution started")) {
              setModal(null);
              go("runs");
            }
          }}
        />
      )}
      {modal === "project" && (
        <ProjectDialog
          data={data}
          loading={loading}
          onClose={() => setModal(null)}
          onImport={async (project) => {
            if (
              await mutate(
                "import",
                { project },
                "Project imported. Review setup and source connections.",
              )
            ) {
              setModal(null);
              go("connections");
            }
          }}
        />
      )}
      {modal === "ai" && (
        <AIDialog
          data={data}
          loading={loading}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
function SetupDialog({
  data,
  loading,
  onClose,
  onSave,
}: {
  data: Data;
  loading: boolean;
  onClose: () => void;
  onSave: (value: Record<string, unknown>) => Promise<void>;
}) {
  const [step, setStep] = useState(0),
    [name, setName] = useState(data.project.name),
    [url, setURL] = useState(
      Object.values(data.project.environments)[0]?.baseURL ?? "",
    ),
    [repository, setRepository] = useState(data.connections.repository),
    [tracker, setTracker] = useState(data.connections.tracker),
    [documentation, setDocumentation] = useState(
      data.connections.documentation,
    ),
    [local, setLocal] = useState(data.connections.localRepository),
    [paths, setPaths] = useState(data.connections.paths.join("\n")),
    [watch, setWatch] = useState(data.connections.watch);
  return (
    <Modal
      title="Set up your quality workspace"
      subtitle="A few thoughtful inputs give your automation better context."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (step < 2) setStep(step + 1);
          else
            void onSave({
              name,
              baseURL: url,
              repository,
              tracker,
              documentation,
              localRepository: local,
              paths: paths
                .split("\n")
                .map((p) => p.trim())
                .filter(Boolean),
              watch,
            });
        }}
      >
        <div className="wizard-steps">
          {["Application", "Knowledge sources", "Maintenance"].map((s, i) => (
            <button
              type="button"
              key={s}
              className={step === i ? "active" : step > i ? "done" : ""}
              onClick={() => setStep(i)}
            >
              <span>{step > i ? <Check size={13} /> : i + 1}</span>
              {s}
            </button>
          ))}
        </div>
        <div className="modal-body form-stack">
          {step === 0 ? (
            <>
              <Field label="Workspace name">
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Northstar Commerce"
                />
              </Field>
              <Field
                label="Application base URL"
                hint="The environment that your tests will access."
              >
                <input
                  required
                  type="url"
                  value={url}
                  onChange={(e) => setURL(e.target.value)}
                  placeholder="https://qa.example.com/"
                />
              </Field>
              <div className="quiet-note">
                <Globe2 size={18} />
                <p>
                  You can configure additional environments and browser profiles
                  in the project configuration.
                </p>
              </div>
            </>
          ) : step === 1 ? (
            <>
              <Field
                label="Application repository URL"
                hint="Saved as a reference. Credentials and remote repository access are not connected here."
              >
                <input
                  type="url"
                  value={repository}
                  onChange={(e) => setRepository(e.target.value)}
                  placeholder="https://github.com/your-team/application"
                />
              </Field>
              <Field label="Jira / Azure DevOps project URL">
                <input
                  type="url"
                  value={tracker}
                  onChange={(e) => setTracker(e.target.value)}
                  placeholder="https://your-team.atlassian.net/…"
                />
              </Field>
              <Field label="Documentation URL">
                <input
                  type="url"
                  value={documentation}
                  onChange={(e) => setDocumentation(e.target.value)}
                  placeholder="https://your-team.example/specifications"
                />
              </Field>
            </>
          ) : (
            <>
              <Field
                label="Local application repository"
                hint="Optional. SuperQ reads committed content and never writes to this repository."
              >
                <input
                  value={local}
                  onChange={(e) => setLocal(e.target.value)}
                  placeholder="/absolute/path/to/application"
                />
              </Field>
              <Field
                label="Source files to monitor"
                hint="One tracked path per line. Use exact evidence.source paths to map changes to tests."
              >
                <textarea
                  value={paths}
                  onChange={(e) => setPaths(e.target.value)}
                  placeholder={"specs/checkout.md\nsrc/api/orders.ts"}
                  rows={4}
                />
              </Field>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={watch}
                  onChange={(e) => setWatch(e.target.checked)}
                />{" "}
                Check committed changes every 30 seconds
              </label>
              <div className="quiet-note">
                <ShieldCheck size={18} />
                <p>
                  Unknown behavior is flagged for interpretation. No new
                  expectations are invented from code changes.
                </p>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <Button onClick={() => (step ? setStep(step - 1) : onClose())}>
            {step ? "Back" : "Cancel"}
          </Button>
          <Button type="submit" kind="primary" disabled={loading}>
            {step === 2 ? "Save workspace" : "Continue"}
            <ArrowRight size={16} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function TestDialog({
  project,
  test,
  pending,
  loading,
  onClose,
  onSave,
  onApprove,
}: {
  project: Project;
  test: TestCase | null;
  pending: boolean;
  loading: boolean;
  onClose: () => void;
  onSave: (test: TestCase) => Promise<void>;
  onApprove: (reviewer: string) => Promise<void>;
}) {
  const first = project.requirements[0];
  const [draft, setDraft] = useState<TestCase>(
    test ?? {
      id: `TC-${crypto.randomUUID().slice(0, 8)}`,
      title: "",
      origin: "qe",
      status: "draft",
      covers: {},
      requirementIds: first ? [first.id] : [],
      evidenceIds: first?.evidenceIds ?? [],
      suites: [Object.keys(project.suites)[0] ?? "regression"],
      tags: [],
      retrySafe: false,
      dependsOn: [],
      blockedBy: [],
      data: {},
      steps: [],
    },
  );
  const [invalidSteps, setInvalidSteps] = useState<Record<number, boolean>>({});
  const [stepKeys, setStepKeys] = useState(() =>
    draft.steps.map(() => crypto.randomUUID()),
  );
  const [tab, setTab] = useState("steps"),
    [code, setCode] = useState(pretty(draft)),
    [reviewer, setReviewer] = useState(""),
    [localError, setLocalError] = useState("");
  const update = (patch: Partial<TestCase>) => setDraft({ ...draft, ...patch });
  function setStep(index: number, step: TestCase["steps"][number]) {
    const steps = [...draft.steps];
    steps[index] = step;
    update({ steps });
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setLocalError("");
    try {
      const next = tab === "code" ? (JSON.parse(code) as TestCase) : draft;
      next.status = "draft";
      delete next.review;
      if (!next.title.trim()) throw new Error("Give the test a clear title");
      await onSave(next);
    } catch (e) {
      setLocalError(
        e instanceof Error ? e.message : "Check the test definition",
      );
    }
  }
  const requirement = project.requirements.find(
    (r) => r.id === draft.requirementIds[0],
  );
  return (
    <Modal
      wide
      title={
        test
          ? "Make the intent clear. Keep the steps reusable."
          : "Create your next test"
      }
      subtitle="Write the expected behavior first, then connect actions and assertions."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="editor-toolbar">
          <Badge>{draft.id}</Badge>
          <Badge tone="blue">Saved as a draft until reviewed</Badge>
          <div className="segmented">
            <button
              type="button"
              className={tab === "steps" ? "active" : ""}
              onClick={() => {
                if (tab === "code") {
                  try {
                    const parsed = JSON.parse(code);
                    setDraft(parsed);
                    setStepKeys(parsed.steps.map(() => crypto.randomUUID()));
                    setInvalidSteps({});
                    setTab("steps");
                    setLocalError("");
                  } catch {
                    setLocalError(
                      "Fix the JSON before returning to the visual builder.",
                    );
                  }
                } else setTab("steps");
              }}
            >
              <Workflow size={14} /> Visual builder
            </button>
            <button
              type="button"
              className={tab === "code" ? "active" : ""}
              onClick={() => {
                setCode(pretty(draft));
                setTab("code");
              }}
            >
              <Code2 size={14} /> Code
            </button>
          </div>
        </div>
        <div className="modal-body">
          {localError && (
            <div className="error-inline" role="alert">
              {localError}
            </div>
          )}
          {tab === "code" ? (
            <Field
              label="Advanced test definition"
              hint="JSON is validated against the same schema used by the CLI. A save returns the test to draft."
            >
              <textarea
                className="code-editor"
                rows={20}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
          ) : (
            <>
              <div className="form-grid">
                <Field label="What should this test prove?">
                  <input
                    required
                    value={draft.title}
                    onChange={(e) => update({ title: e.target.value })}
                    placeholder="e.g. Reject an order when the basket is empty"
                  />
                </Field>
                <Field label="Requirement">
                  <select
                    value={draft.requirementIds[0] ?? ""}
                    onChange={(e) => {
                      const r = project.requirements.find(
                        (r) => r.id === e.target.value,
                      )!;
                      update({
                        requirementIds: [r.id],
                        evidenceIds: r.evidenceIds,
                        covers: {},
                      });
                    }}
                  >
                    {project.requirements.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id} · {r.title}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="criterion-picker">
                <span className="field-label">
                  Acceptance criteria this test covers
                </span>
                {requirement?.criteria.map((c) => (
                  <label key={c.id}>
                    <input
                      type="checkbox"
                      checked={
                        draft.covers[requirement.id]?.includes(c.id) ?? false
                      }
                      onChange={(e) =>
                        update({
                          covers: {
                            ...draft.covers,
                            [requirement.id]: e.target.checked
                              ? [...(draft.covers[requirement.id] ?? []), c.id]
                              : (draft.covers[requirement.id] ?? []).filter(
                                  (id) => id !== c.id,
                                ),
                          },
                        })
                      }
                    />
                    {c.title}
                  </label>
                ))}
              </div>
              <div className="section-heading editor-section">
                <h3>Actions & validations</h3>
                <span className="muted">
                  Reuse catalog actions. Add independent expected results.
                </span>
              </div>
              {draft.steps.map((s, index) => (
                <StepEditor
                  key={stepKeys[index] ?? index}
                  step={s}
                  index={index}
                  project={project}
                  onChange={(value) => setStep(index, value)}
                  onValidity={(invalid) =>
                    setInvalidSteps((prev) => ({ ...prev, [index]: invalid }))
                  }
                  onRemove={() => {
                    setStepKeys((keys) => keys.filter((_, i) => i !== index));
                    setInvalidSteps({});
                    update({
                      steps: draft.steps.filter((_, i) => i !== index),
                    });
                  }}
                />
              ))}
              <button
                type="button"
                className="add-step"
                onClick={() => {
                  setStepKeys((keys) => [...keys, crypto.randomUUID()]);
                  update({
                    steps: [
                      ...draft.steps,
                      {
                        action: project.catalog[0]?.id ?? "",
                        input: { path: "api/inventory" },
                        assertions: [
                          { path: "status", operator: "equals", expected: 200 },
                          {
                            path: "body.available",
                            operator: "equals",
                            expected: true,
                          },
                        ],
                        save: {},
                      },
                    ],
                  });
                }}
              >
                <Plus size={17} /> Add a reusable action
              </button>
              <div className="form-grid spaced">
                <Field label="Suite">
                  <select
                    value={draft.suites[0]}
                    onChange={(e) => update({ suites: [e.target.value] })}
                  >
                    {Object.keys(project.suites).map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </Field>
                {Object.keys(project.roles ?? {}).length > 0 && (
                  <Field label="Application role">
                    <select
                      value={draft.anonymous ? "__anon__" : (draft.role ?? "")}
                      onChange={(e) =>
                        update(
                          e.target.value === "__anon__"
                            ? {
                                anonymous: true,
                                role: undefined,
                                user: undefined,
                              }
                            : {
                                anonymous: undefined,
                                role: e.target.value || undefined,
                              },
                        )
                      }
                    >
                      <option value="">Use environment default</option>
                      <option value="__anon__">Anonymous (no login)</option>
                      {Object.keys(project.roles ?? {}).map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field
                  label="Tags"
                  hint="Comma-separated, for example smoke, checkout"
                >
                  <input
                    value={draft.tags.join(", ")}
                    onChange={(e) =>
                      update({
                        tags: e.target.value
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </Field>
                <Field
                  label="Blockers"
                  hint="One per line; clear only when actually resolved."
                >
                  <textarea
                    value={draft.blockedBy.join("\n")}
                    onChange={(e) =>
                      update({
                        blockedBy: e.target.value.split("\n").filter(Boolean),
                      })
                    }
                    rows={2}
                  />
                </Field>
                <Field
                  label="Dependencies"
                  hint="Comma-separated existing test IDs."
                >
                  <input
                    value={draft.dependsOn.join(", ")}
                    onChange={(e) =>
                      update({
                        dependsOn: e.target.value
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </Field>
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={draft.retrySafe}
                  onChange={(e) => update({ retrySafe: e.target.checked })}
                />{" "}
                Safe to repeat this entire test if retries are enabled
              </label>
            </>
          )}
          {test && (
            <details className="review-attestation">
              <summary>
                <FileCheck2 size={16} /> Record a human review of the saved
                version
              </summary>
              <p>
                Review the saved definition and supporting evidence first.
                Unsaved editor changes are not included. This is a local
                attestation, not an authenticated signature.
              </p>
              <Field label="Reviewer name">
                <input
                  value={reviewer}
                  onChange={(e) => setReviewer(e.target.value)}
                  placeholder="Your name"
                />
              </Field>
              {pending && (
                <p className="amber-text">
                  Stage the pending source change before approving this test.
                </p>
              )}
              <Button
                disabled={!reviewer.trim() || pending || loading}
                onClick={() => void onApprove(reviewer)}
              >
                Record review of saved test <Check size={15} />
              </Button>
            </details>
          )}
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            kind="primary"
            disabled={loading || Object.values(invalidSteps).some(Boolean)}
          >
            {loading ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}{" "}
            Save test as draft
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function StepEditor({
  step,
  index,
  project,
  onChange,
  onValidity,
  onRemove,
}: {
  step: TestCase["steps"][number];
  index: number;
  project: Project;
  onChange: (value: TestCase["steps"][number]) => void;
  onValidity: (invalid: boolean) => void;
  onRemove: () => void;
}) {
  const [input, setInput] = useState(pretty(step.input)),
    [capture, setCapture] = useState(pretty(step.save)),
    [invalid, setInvalid] = useState(false),
    [invalidCapture, setInvalidCapture] = useState(false);
  useEffect(
    () => onValidity(invalid || invalidCapture),
    [invalid, invalidCapture, index],
  );
  function inputChanged(value: string) {
    setInput(value);
    try {
      onChange({ ...step, input: JSON.parse(value) });
      setInvalid(false);
      onValidity(invalidCapture);
    } catch {
      setInvalid(true);
      onValidity(true);
    }
  }
  const action = project.catalog.find((a) => a.id === step.action);
  const apply = (value: Record<string, unknown>) => {
    setInput(pretty(value));
    setInvalid(false);
    onChange({ ...step, input: value });
  };
  const commands = (
    Array.isArray(step.input.commands) ? step.input.commands : []
  ) as Record<string, unknown>[];
  const commandChange = (i: number, value: Record<string, unknown>) =>
    apply({
      ...step.input,
      commands: commands.map((c, n) => (n === i ? value : c)),
    });
  return (
    <div className="step-card">
      <div className="step-heading">
        <span className="step-number">{index + 1}</span>
        <select
          aria-label={`Step ${index + 1} action`}
          value={step.action}
          onChange={(e) => {
            const a = project.catalog.find((a) => a.id === e.target.value);
            const value =
              a?.kind === "web"
                ? { commands: [{ type: "goto", path: "checkout" }] }
                : { path: "api/inventory", method: "GET" };
            setInput(pretty(value));
            onChange({ ...step, action: e.target.value, input: value });
          }}
        >
          {project.catalog.map((a) => (
            <option key={a.id} value={a.id}>
              {a.description}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="icon-button"
          aria-label={`Remove step ${index + 1}`}
          onClick={onRemove}
        >
          <X size={16} />
        </button>
      </div>
      <div className="step-body">
        {action?.kind === "api" && (
          <div className="form-grid">
            <Field label="HTTP method">
              <select
                value={String(step.input.method ?? "GET")}
                onChange={(e) =>
                  apply({ ...step.input, method: e.target.value })
                }
              >
                {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Request path">
              <input
                value={String(step.input.path ?? "")}
                onChange={(e) => apply({ ...step.input, path: e.target.value })}
                placeholder="api/orders"
              />
            </Field>
          </div>
        )}
        {action?.kind === "web" && (
          <div className="browser-builder">
            {Array.isArray(step.input.setupIds) &&
              step.input.setupIds.length > 0 && (
                <p>
                  Shared setup: {step.input.setupIds.map(String).join(", ")}.
                  Runs before this case’s commands in the same isolated browser.
                </p>
              )}
            {commands.map((c, i) => (
              <div className="browser-command" key={i}>
                <select
                  aria-label={`Browser step ${i + 1} type`}
                  value={String(c.type)}
                  onChange={(e) =>
                    commandChange(
                      i,
                      e.target.value === "goto"
                        ? { type: "goto", path: "" }
                        : e.target.value === "fill"
                          ? {
                              type: "fill",
                              locator: Object.keys(project.locators)[0],
                              value: "",
                            }
                          : e.target.value === "expectText"
                            ? {
                                type: "expectText",
                                locator: Object.keys(project.locators)[0],
                                value: "",
                                timeoutMs: 5000,
                              }
                            : {
                                type: e.target.value,
                                locator: Object.keys(project.locators)[0],
                              },
                    )
                  }
                >
                  {[
                    ["goto", "Open a page"],
                    ["click", "Click an element"],
                    ["fill", "Enter text"],
                    ["text", "Read visible text"],
                    ["expectText", "Verify visible text"],
                  ].map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {c.type === "goto" ? (
                  <input
                    aria-label={`Browser step ${i + 1} path`}
                    value={String(c.path ?? "")}
                    onChange={(e) =>
                      commandChange(i, { ...c, path: e.target.value })
                    }
                    placeholder="Page path"
                  />
                ) : (
                  <select
                    aria-label={`Browser step ${i + 1} locator`}
                    value={String(c.locator ?? "")}
                    onChange={(e) =>
                      commandChange(i, { ...c, locator: e.target.value })
                    }
                  >
                    {Object.keys(project.locators).map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                )}
                {["fill", "expectText"].includes(String(c.type)) && (
                  <input
                    aria-label={`Browser step ${i + 1} text`}
                    value={String(c.value ?? "")}
                    onChange={(e) =>
                      commandChange(i, { ...c, value: e.target.value })
                    }
                    placeholder={
                      c.type === "fill"
                        ? "Value to enter"
                        : "Expected visible text"
                    }
                  />
                )}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove browser step ${i + 1}`}
                  onClick={() =>
                    apply({
                      ...step.input,
                      commands: commands.filter((_, n) => n !== i),
                    })
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            <Button
              onClick={() =>
                apply({
                  ...step.input,
                  commands: [
                    ...commands,
                    {
                      type: "click",
                      locator: Object.keys(project.locators)[0],
                    },
                  ],
                })
              }
            >
              <Plus size={14} /> Add browser step
            </Button>
          </div>
        )}
        <details className="advanced-inputs">
          <summary>
            <Code2 size={14} /> Advanced action inputs (JSON)
          </summary>
          <Field
            label="Action inputs"
            hint={
              invalid
                ? "Invalid JSON — fix before saving."
                : "Configure the request or browser journey. Use ${variable} for test data."
            }
          >
            <textarea
              aria-invalid={invalid}
              className="mini-code"
              rows={5}
              value={input}
              onChange={(e) => inputChanged(e.target.value)}
            />
          </Field>
        </details>
        <div className="assertion-label">
          <Target size={15} /> Expected results
        </div>
        {step.assertions.map((assertion, i) => (
          <div className="assertion-row" key={i}>
            <input
              aria-label={`Step ${index + 1} assertion ${i + 1} response path`}
              value={assertion.path}
              placeholder="body.status"
              onChange={(e) => {
                const a = [...step.assertions];
                a[i] = { ...assertion, path: e.target.value };
                onChange({ ...step, assertions: a });
              }}
            />
            <select
              aria-label={`Step ${index + 1} assertion ${i + 1} operator`}
              value={assertion.operator}
              onChange={(e) => {
                const a = [...step.assertions];
                a[i] = {
                  ...assertion,
                  operator: e.target.value as typeof assertion.operator,
                };
                onChange({ ...step, assertions: a });
              }}
            >
              {["equals", "contains", "exists", "matches"].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
            <input
              aria-label={`Step ${index + 1} assertion ${i + 1} expected value`}
              value={
                typeof assertion.expected === "string"
                  ? assertion.expected
                  : (JSON.stringify(assertion.expected) ?? "")
              }
              disabled={assertion.operator === "exists"}
              placeholder="Expected value"
              onChange={(e) => {
                let expected: unknown = e.target.value;
                try {
                  expected = JSON.parse(e.target.value);
                } catch {}
                const a = [...step.assertions];
                a[i] = { ...assertion, expected };
                onChange({ ...step, assertions: a });
              }}
            />
            <button
              type="button"
              className="icon-button"
              aria-label="Remove assertion"
              onClick={() =>
                onChange({
                  ...step,
                  assertions: step.assertions.filter((_, n) => n !== i),
                })
              }
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="text-button"
          onClick={() =>
            onChange({
              ...step,
              assertions: [
                ...step.assertions,
                { path: "body.status", operator: "equals", expected: "" },
              ],
            })
          }
        >
          <Plus size={14} /> Add an assertion
        </button>
        <details className="capture">
          <summary>Capture a response field for the next step</summary>
          <textarea
            className="mini-code"
            rows={2}
            value={capture}
            onChange={(e) => {
              setCapture(e.target.value);
              try {
                onChange({ ...step, save: JSON.parse(e.target.value) });
                setInvalidCapture(false);
                onValidity(invalid);
              } catch {
                setInvalidCapture(true);
                onValidity(true);
              }
            }}
            placeholder={'{"orderId": "body.id"}'}
          />
          {invalidCapture && (
            <span className="red-text">Invalid capture JSON</span>
          )}
        </details>
      </div>
    </div>
  );
}
function RequirementDialog({
  project,
  loading,
  onClose,
  onSave,
}: {
  project: Project;
  loading: boolean;
  onClose: () => void;
  onSave: (value: Project) => Promise<void>;
}) {
  const [title, setTitle] = useState(""),
    [risk, setRisk] = useState("high"),
    [criteria, setCriteria] = useState(""),
    [source, setSource] = useState(""),
    [excerpt, setExcerpt] = useState("");
  return (
    <Modal
      title="Start with an expected outcome"
      subtitle="Give your tests a business reason and an evidence trail."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const id = `REQ-${crypto.randomUUID().slice(0, 8)}`,
            evidenceId = `SPEC-${id}`,
            next = structuredClone(project);
          next.evidence.push({
            id: evidenceId,
            source,
            revision: "manual-draft",
            excerpt,
          });
          next.requirements.push({
            id,
            title,
            risk: risk as "high",
            evidenceIds: [evidenceId],
            criteria: criteria
              .split("\n")
              .filter(Boolean)
              .map((title, i) => ({ id: `${id}-AC-${i + 1}`, title })),
          });
          void onSave(next);
        }}
      >
        <div className="modal-body form-stack">
          <Field label="Requirement title">
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Apply discounts accurately"
            />
          </Field>
          <Field label="Business risk">
            <select value={risk} onChange={(e) => setRisk(e.target.value)}>
              {["critical", "high", "medium", "low"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
          <Field
            label="Acceptance criteria"
            hint="One observable behavior per line. Include failure and boundary cases."
          >
            <textarea
              required
              rows={4}
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
            />
          </Field>
          <Field label="Evidence source">
            <input
              required
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="specs/discounts.md or a story URL"
            />
          </Field>
          <Field label="Supporting specification">
            <textarea
              required
              rows={3}
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              placeholder="Paste the approved source text that defines this behavior."
            />
          </Field>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" kind="primary" disabled={loading}>
            Add requirement <ArrowRight size={16} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function CompareDialog({
  data,
  loading,
  onClose,
  onCompare,
}: {
  data: Data;
  loading: boolean;
  onClose: () => void;
  onCompare: (value: Project) => Promise<void>;
}) {
  const [text, setText] = useState(""),
    [error, setError] = useState("");
  return (
    <Modal
      wide
      title="Understand the impact of a change"
      subtitle="Compare this workspace with an updated SuperQ project definition."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            void onCompare(JSON.parse(text));
          } catch {
            setError("Choose a valid project JSON file or fix the editor.");
          }
        }}
      >
        <div className="modal-body form-stack">
          <div className="notice">
            <GitCompareArrows size={19} />
            <span>
              The comparison identifies changes to requirements, assertions,
              locators and workflows, then finds related tests and dependents.
              Existing pending comparisons are replaced only when you continue.
            </span>
          </div>
          <label className="upload-zone">
            <Upload size={24} />
            <strong>Choose an updated project JSON</strong>
            <span>
              Your current workspace stays unchanged until you stage a proposal.
            </span>
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void f.text().then(setText);
              }}
            />
          </label>
          <Field label="Updated project definition">
            <textarea
              className="code-editor"
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste the updated project JSON…"
            />
          </Field>
          {error && (
            <div className="error-inline" role="alert">
              {error}
            </div>
          )}
          <Download name="current-project.json" value={data.project} />
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            kind="primary"
            type="submit"
            disabled={loading || !text.trim()}
          >
            Find affected tests <ArrowRight size={16} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function RunDialog({
  data,
  loading,
  pending,
  onClose,
  onRun,
}: {
  data: Data;
  loading: boolean;
  pending: number;
  onClose: () => void;
  onRun: (value: Record<string, unknown>) => Promise<void>;
}) {
  const [environment, setEnvironment] = useState(
      Object.keys(data.project.environments)[0],
    ),
    [account, setAccount] = useState(""),
    [suite, setSuite] = useState(Object.keys(data.project.suites)[0]),
    [profile, setProfile] = useState(Object.keys(data.project.browsers)[0]),
    [workers, setWorkers] = useState(
      Math.min(data.project.execution.workers, 16),
    ),
    [ack, setAck] = useState(false),
    [testIds, setTestIds] = useState<string[]>([]),
    [validateDrafts, setValidateDrafts] = useState(false),
    [captureTrace, setCaptureTrace] = useState(false);
  const affected =
    data.plan?.items
      .filter((i) => i.status === "pending")
      .map((i) => i.testId) ?? [];
  const selectedTests = testIds.length
    ? testIds
    : data.project.tests
        .filter((t) => t.suites.includes(suite))
        .map((t) => t.id);
  const selectedPending = selectedTests.some((id) => affected.includes(id));
  const cloud = data.project.browsers[profile]?.provider !== "local";
  return (
    <Modal
      title="Run with the right context"
      subtitle="Choose a suite and target. Every blocker and failed attempt stays visible."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onRun({
            environment,
            ...(account ? { user: account } : {}),
            suite,
            profile,
            workers,
            testIds,
            validateDrafts,
            acknowledgeCloud: ack,
            captureTrace,
            acknowledgeSensitiveTrace: captureTrace,
          });
        }}
      >
        <div className="modal-body form-stack">
          {selectedPending && (
            <div className="notice amber">
              <GitCompareArrows size={18} />
              <span>
                Some selected tests have pending changes. Review them or select
                unaffected tests. Prerequisites are checked too.
              </span>
            </div>
          )}
          <div className="form-grid">
            <Field label="Environment">
              <select
                value={environment}
                onChange={(e) => {
                  setEnvironment(e.target.value);
                  setAccount("");
                }}
              >
                {Object.keys(data.project.environments).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            {Object.keys(data.project.environments[environment!]?.users ?? {})
              .length > 0 && (
              <Field label="Test account">
                <select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  <option value="">
                    Use each test's role and environment default
                  </option>
                  {Object.entries(
                    data.project.environments[environment!]?.users ?? {},
                  ).map(([id, u]) => (
                    <option key={id} value={id}>
                      {id} ({u.role})
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Suite">
              <select
                value={suite}
                onChange={(e) => {
                  setSuite(e.target.value);
                  setTestIds([]);
                }}
              >
                {Object.keys(data.project.suites).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Browser profile">
              <select
                value={profile}
                onChange={(e) => {
                  setProfile(e.target.value);
                  setAck(false);
                }}
              >
                {Object.entries(data.project.browsers).map(([id, b]) => (
                  <option key={id} value={id}>
                    {id} · {b.browser} · {b.provider}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Parallel workers">
              <input
                type="number"
                min="1"
                max="16"
                value={workers}
                onChange={(e) => setWorkers(Number(e.target.value))}
              />
            </Field>
          </div>
          <label>
            <input
              type="checkbox"
              checked={captureTrace}
              onChange={(e) => setCaptureTrace(e.target.checked)}
            />{" "}
            Capture private Playwright traces. I understand screenshots, DOM and
            network may contain secrets or personal data. Local retention: 24
            hours; up to 20 journeys per run. Traces are downloaded separately
            from reports.
          </label>
          <div className="run-selection">
            <span className="field-label">Tests to run</span>
            <label>
              <input
                type="checkbox"
                checked={testIds.length === 0}
                onChange={() => setTestIds([])}
              />{" "}
              Entire suite
            </label>
            {data.project.tests
              .filter((t) => t.suites.includes(suite))
              .map((t) => (
                <label key={t.id}>
                  <input
                    type="checkbox"
                    checked={testIds.includes(t.id)}
                    onChange={(e) =>
                      setTestIds(
                        e.target.checked
                          ? [...testIds, t.id]
                          : testIds.filter((id) => id !== t.id),
                      )
                    }
                  />
                  <span>
                    {t.id} · {t.title}
                  </span>
                  {affected.includes(t.id) && (
                    <Badge tone="amber">Needs review</Badge>
                  )}
                </label>
              ))}
            {testIds.length > 0 && (
              <small>
                Focused execution is partial coverage and cannot authorize
                promotion.
              </small>
            )}
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={validateDrafts}
              onChange={(e) => setValidateDrafts(e.target.checked)}
            />{" "}
            Validate draft definitions (exploratory; no approval or promotion
            evidence)
          </label>
          {cloud && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                required
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />{" "}
              I understand this uses my cloud account, may incur charges, and
              needs configured credentials/tunnels.
            </label>
          )}
          <div className="quiet-note">
            <ShieldCheck size={18} />
            <p>
              Drafts are skipped unless exploratory validation is selected.
              Blockers remain visible. A passing suite is not a production
              certification.
            </p>
          </div>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            kind="primary"
            disabled={loading || selectedPending || (cloud && !ack)}
          >
            <Play size={16} /> Start run
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function ProjectDialog({
  data,
  loading,
  onClose,
  onImport,
}: {
  data: Data;
  loading: boolean;
  onClose: () => void;
  onImport: (value: Project) => Promise<void>;
}) {
  const [text, setText] = useState(""),
    [error, setError] = useState("");
  return (
    <Modal
      wide
      title="Your project, portable and inspectable"
      subtitle="Export the current project or import an existing SuperQ project."
      onClose={onClose}
    >
      <div className="modal-body form-stack">
        <Download name="superq-project.json" value={data.project} />
        <div className="quiet-note">
          <Code2 size={18} />
          <p>
            To update existing features safely, use Compare versions. Import
            replaces the active project, clears the current comparison, and
            pauses source monitoring.
          </p>
        </div>
        <label className="upload-zone">
          <Upload size={24} />
          <strong>Import a project JSON</strong>
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void f.text().then(setText);
            }}
          />
        </label>
        <textarea
          aria-label="Project JSON to import"
          className="code-editor"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste project JSON to import…"
        />
        {error && <div className="error-inline">{error}</div>}
        <details>
          <summary>Inspect current configuration</summary>
          <pre className="configuration-preview">{pretty(data.project)}</pre>
        </details>
      </div>
      <div className="modal-footer">
        <Button onClick={onClose}>Close</Button>
        <Button
          kind="primary"
          disabled={!text || loading}
          onClick={() => {
            try {
              void onImport(JSON.parse(text));
            } catch {
              setError("Invalid JSON. Your current project has not changed.");
            }
          }}
        >
          Import project
        </Button>
      </div>
    </Modal>
  );
}
function AIDialog({
  data,
  onClose,
}: {
  data: Data;
  loading: boolean;
  onClose: () => void;
}) {
  const [model, setModel] = useState(""),
    [requirement, setRequirement] = useState(
      data.project.requirements[0]?.id ?? "",
    ),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<unknown>(null),
    [error, setError] = useState("");
  return (
    <Modal
      title="A second perspective, grounded in evidence"
      subtitle="Use your installed local Ollama model to propose additional test ideas."
      onClose={onClose}
    >
      <div className="modal-body form-stack">
        <Field
          label="Installed local model"
          hint="No model is automatically downloaded or selected."
        >
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Enter your installed model name"
          />
        </Field>
        <Field label="Requirement">
          <select
            value={requirement}
            onChange={(e) => setRequirement(e.target.value)}
          >
            {data.project.requirements.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </Field>
        <div className="quiet-note">
          <ShieldCheck size={18} />
          <p>
            Only linked source evidence and the action catalog are sent to the
            local daemon. Check your daemon privacy settings. Output is a draft,
            not verified application behavior.
          </p>
        </div>
        {error && (
          <div className="error-inline" role="alert">
            {error}
          </div>
        )}
        {result !== null && (
          <div className="ai-result">
            <Badge tone="purple">Draft · human review required</Badge>
            <pre>{pretty(result)}</pre>
            <Download name="superq-ai-draft.json" value={result} />
          </div>
        )}
      </div>
      <div className="modal-footer">
        <Button onClick={onClose}>Close</Button>
        <Button
          kind="primary"
          disabled={!model.trim() || busy}
          onClick={() =>
            void (async () => {
              setBusy(true);
              setError("");
              try {
                const response = await fetch("/api/ai", {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    "x-superq-token": data.token,
                  },
                  body: JSON.stringify({
                    revision: data.revision,
                    model,
                    requirement,
                  }),
                });
                const value = await response.json();
                if (!response.ok) throw new Error(value.error);
                setResult(value.proposal);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Local AI could not respond",
                );
              } finally {
                setBusy(false);
              }
            })()
          }
        >
          {busy ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <Sparkles size={16} />
          )}{" "}
          {busy ? "Preparing a draft…" : "Suggest test ideas"}
        </Button>
      </div>
    </Modal>
  );
}

async function downloadTrace(id: string, token: string) {
  const response = await fetch(`/api/traces/${id}`, {
    headers: { "x-superq-token": token },
  });
  if (!response.ok) throw new Error("Trace unavailable or expired");
  const url = URL.createObjectURL(await response.blob()),
    a = document.createElement("a");
  a.href = url;
  a.download = `superq-${id}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
