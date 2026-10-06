import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import {
  DistributionGroupPage,
  DistributionHomePage,
  DistributionLinePage,
  NotFoundPage,
} from "./pages/DistributionPages.jsx";
import MonitoringPage from "./pages/MonitoringPage.jsx";
import StatisticsPage from "./pages/StatisticsPage.jsx";
import { DocsPanel } from "./components/ui/DocsPanel.jsx";
import { userErrorMessage } from "./utils/clientErrors.js";

function readCookie(name) {
  const prefix = `${name}=`;
  const entry = document.cookie.split(";").map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : "";
}

async function authenticatedFetch(url, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.method && !["GET", "HEAD", "OPTIONS"].includes(options.method.toUpperCase())) {
    headers.set("X-CSRF-Token", readCookie("chocolat_csrf"));
  }
  return fetch(url, { ...options, headers, credentials: "same-origin" });
}

const defaultNotifications = [
  {
    id: 1,
    text: "Retour du contrôle qualité — Ligne 8",
    message: "Merci de vérifier le champ INFO FOURRAGE : la valeur indique une pluralité. Confirme que l’ingrédient est bien au pluriel ou corrige la saisie, puis renvoie la ligne pour un nouveau contrôle.",
    date: "2026-10-02T08:52:00",
    link: "/distribution/groupe/1/ligne/8",
  },
];

function getRoleLabel(role) {
  if (role === "SUPERVISEUR") return "Superviseur";
  if (role === "ADMIN") return "Admin";
  return "Agent";
}

function getRoleOptions() {
  return ["", "AGENT", "SUPERVISEUR", "ADMIN"];
}

function formatEAT(date) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Nairobi",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

function formatDateInput(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getNavigation(role) {
  const base = [
    { to: "/accueil", label: "Accueil" },
    { to: "/distribution", label: "Distribution" },
    { to: "/statistiques", label: "Statistiques" },
    { to: "/qualite", label: "Contrôle Qualité" },
  ];

  if (role === "SUPERVISEUR" || role === "ADMIN") {
    base.push({ to: "/donnees", label: "Données" });
  }

  if (role === "ADMIN") {
    base.push({ to: "/utilisateurs", label: "Gestion utilisateurs" });
    base.push({ to: "/connexion-sheet", label: "Connexion Google Sheets" });
    base.push({ to: "/monitoring", label: "Monitoring" });
  } else if (role === "SUPERVISEUR") {
    base.push({ to: "/utilisateurs", label: "Gestion utilisateurs" });
  }

  return base;
}

function NotificationBell({ notifications }) {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="notification" ref={ref}>
      <button className="notification__button" type="button" aria-label="Notifications" onClick={() => setOpen((value) => !value)}>
        <span aria-hidden="true">🔔</span>
        {notifications.length > 0 && <span className="notification__badge">{notifications.length}</span>}
      </button>
      {open && (
        <div className="notification__panel" role="dialog" aria-label="Notifications">
          <div className="notification__header">Notifications</div>
          {notifications.length === 0 ? (
            <p className="notification__empty">Aucune notification.</p>
          ) : (
            <ul className="notification__list">
              {notifications.map((item) => (
                <li key={item.id} className="notification__item">
                  <div className="notification__meta">
                    <button
                      className="notification__title"
                      type="button"
                      aria-expanded={expandedId === item.id}
                      onClick={() => setExpandedId((current) => current === item.id ? null : item.id)}
                    >
                      {item.text}
                    </button>
                    <span>{new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Nairobi" }).format(new Date(item.date))}</span>
                  </div>
                  {expandedId === item.id && <p className="notification__message">{item.message}</p>}
                  <Link to={item.link} onClick={() => setOpen(false)}>Accéder à la ligne concernée</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function AppShell({ user, notifications, onLogout, children }) {
  const [now, setNow] = useState(new Date());
  const navItems = useMemo(() => getNavigation(user.role), [user.role]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="app-shell wrap">
      <header className="topbar">
        <nav className="main-nav" aria-label="Navigation principale">
          {navItems.map(({ to, label }) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "is-active" : "") }>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="topbar__tools">
          <NotificationBell notifications={notifications} />
          <button className="btn btn--ghost" type="button" onClick={onLogout}>Déconnexion</button>
        </div>
      </header>

      <div className="clock-block" aria-live="polite">
        <span className="clock-block__label">Heure actuelle</span>
        <strong>{formatEAT(now)}</strong>
      </div>

      {children}
      <DocsPanel />
    </div>
  );
}

function getSummaryCards(summary) {
  const validatedLines = summary?.validatedLines ?? 0;
  const returnsReceived = summary?.returnsReceived ?? 0;
  const connectedHours = summary?.connectedHours ?? 0;
  const yesterdayProduction = summary?.yesterdayProduction ?? 0;
  return [
    { label: "Lignes validées", value: validatedLines.toLocaleString("fr-FR"), trend: "Soumissions enregistrées" },
    { label: "Retours reçus", value: returnsReceived.toLocaleString("fr-FR"), trend: "Retours CQ enregistrés" },
    { label: "Temps moyen connecté", value: `${connectedHours}h`, trend: connectedHours ? "Mesuré" : "Non mesuré" },
    { label: "Production J-1", value: yesterdayProduction.toLocaleString("fr-FR"), trend: "Soumissions de la veille" },
  ];
}

function HomePage({ user, storageMode }) {
  const fullName = `${user.firstName} ${user.lastName}`;
  const [summary, setSummary] = useState({ validatedLines: 0, returnsReceived: 0, connectedHours: 0, yesterdayProduction: 0 });
  const [summaryError, setSummaryError] = useState(false);

  useEffect(() => {
    let active = true;
    const loadSummary = async () => {
      try {
        const response = await fetch("/api/v1/stats/summary");
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error("Résumé indisponible");
        if (active) {
          setSummary(body.data);
          setSummaryError(false);
        }
      } catch {
        if (active) setSummaryError(true);
      }
    };
    loadSummary();
    const timer = window.setInterval(loadSummary, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const summaryCards = getSummaryCards(summary);

  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">Bienvenue</p>
        <h1>Bienvenue, {fullName}</h1>
        <p>Rôle : {getRoleLabel(user.role)}</p>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Suivi de production</h2>
        </div>
        <p className="summary-source" role={summaryError ? "alert" : "status"}>
          {summaryError
            ? "Indicateurs indisponibles : impossible de lire les enregistrements réels."
            : storageMode === "mongodb"
              ? "Production suivie depuis MongoDB."
              : storageMode === "memory"
                ? "Stockage mémoire temporaire : les données ne sont pas persistantes."
                : "Connexion au stockage en cours…"}
        </p>
        <div className="kpi-grid">
          {summaryCards.map((item) => (
            <div key={item.label} className="metric-card">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <small>{item.trend}</small>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function QualityPage({ users = [], user }) {
  const navigate = useNavigate();
  const [treatments, setTreatments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [feedbackByRow, setFeedbackByRow] = useState({});
  const [sendingRow, setSendingRow] = useState(null);
  const [filters, setFilters] = useState({
    query: "",
    firstName: "",
    lastName: "",
    role: "",
    startDate: "",
    endDate: "",
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);

  const loadTreatments = async (requestedPage = 0, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const response = await fetch(`/api/v1/quality/treatments?page=${requestedPage}`, { credentials: "same-origin" });
      const body = await response.json();
      if (!response.ok || !body.success) {
        throw new Error(body.errors?.[0]?.message ?? `Erreur ${response.status}`);
      }
      setTreatments((current) => append ? [...current, ...(body.data.treatments ?? [])] : body.data.treatments ?? []);
      setPage(body.data.page);
      setHasMore(body.data.hasMore);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Impossible de charger les lignes à contrôler.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => { loadTreatments(); }, []);

  const rows = useMemo(() => {
    const usersById = new Map(users.map((entry) => [String(entry.id), entry]));
    const needle = appliedFilters.query.trim().toLowerCase();
    return treatments.map((treatment) => {
      const line = treatment.sourceRow - 1;
      const agentId = String(treatment.lastUpdatedBy?.actorId ?? "");
      const agent = usersById.get(agentId);
      const values = treatment.currentData ?? {};
      const updatedAt = treatment.lastUpdatedAt ? new Date(treatment.lastUpdatedAt) : null;
      return {
        ...treatment,
        id: `${treatment.sourceRow}`,
        line,
        block: `Lignes ${Math.floor((line - 1) / 50) * 50 + 1}-${Math.floor((line - 1) / 50) * 50 + 50}`,
        ean: values.EAN13 ?? "",
        product: values.NOM ?? "",
        speciality: values["NEW NOM DE SPECIALITE"] ?? "",
        firstName: agent?.firstName ?? "Agent",
        lastName: agent?.lastName ?? "",
        agent: agent?.fullName ?? agent?.login ?? agentId,
        role: agent?.role ?? (treatment.lastUpdatedBy?.actorType === "QC" ? "SUPERVISEUR" : "AGENT"),
        date: updatedAt ? formatDateInput(updatedAt) : "",
        time: updatedAt ? new Intl.DateTimeFormat("fr-FR", { timeStyle: "short", timeZone: "Africa/Nairobi" }).format(updatedAt) : "",
      };
    }).filter((row) => {
      const matchesQuery = needle === "" || [row.agent, row.product, row.speciality, row.ean, row.block].join(" ").toLowerCase().includes(needle);
      const matchesFirstName = !appliedFilters.firstName || row.firstName.toLowerCase().includes(appliedFilters.firstName.trim().toLowerCase());
      const matchesLastName = !appliedFilters.lastName || row.lastName.toLowerCase().includes(appliedFilters.lastName.trim().toLowerCase());
      const matchesRole = !appliedFilters.role || row.role === appliedFilters.role;
      const matchesStart = !appliedFilters.startDate || row.date >= appliedFilters.startDate;
      const matchesEnd = !appliedFilters.endDate || row.date <= appliedFilters.endDate;
      return matchesQuery && matchesFirstName && matchesLastName && matchesRole && matchesStart && matchesEnd;
    });
  }, [treatments, users, appliedFilters]);

  const handleSendReturn = (row) => {
    const groupStart = Math.floor((row.line - 1) / 50) * 50 + 1;
    navigate(`/distribution/groupe/${groupStart}/ligne/${row.line}`);
  };

  const handleApplyFilters = () => setAppliedFilters(filters);
  const sendFeedback = async (row) => {
    const message = (feedbackByRow[row.sourceRow] ?? "").trim();
    if (!message) {
      setError("Saisis le retour à transmettre à l’agent.");
      return;
    }
    setSendingRow(row.sourceRow);
    setError("");
    try {
      const response = await authenticatedFetch(`/api/v1/quality/treatments/${row.sourceRow}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) {
        throw new Error(body.errors?.[0]?.message ?? `Erreur ${response.status}`);
      }
      setFeedbackByRow((current) => ({ ...current, [row.sourceRow]: "" }));
      await loadTreatments();
    } catch (sendError) {
      setError(sendError.message || "Impossible d’envoyer le retour.");
    } finally {
      setSendingRow(null);
    }
  };

  return (
    <main className="page-shell">
      <section className="panel">
        <div className="panel__header panel__header--stacked">
          <h2>Page de Contrôle Qualité</h2>
          <div className="toolbar toolbar--wide">
            <input
              className="control"
              type="search"
              placeholder="Nom, prénom, produit, rôle, EAN..."
              value={filters.query}
              onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
            />
            <input
              className="control"
              type="text"
              placeholder="Prénom"
              value={filters.firstName}
              onChange={(event) => setFilters((current) => ({ ...current, firstName: event.target.value }))}
            />
            <input
              className="control"
              type="text"
              placeholder="Nom"
              value={filters.lastName}
              onChange={(event) => setFilters((current) => ({ ...current, lastName: event.target.value }))}
            />
            <select
              className="control"
              value={filters.role}
              onChange={(event) => setFilters((current) => ({ ...current, role: event.target.value }))}
            >
              <option value="">Tous les rôles</option>
              <option value="AGENT">Agent</option>
              <option value="SUPERVISEUR">Superviseur</option>
              <option value="ADMIN">Admin</option>
            </select>
            <input
              className="control"
              type="date"
              value={filters.startDate}
              onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))}
            />
            <input
              className="control"
              type="date"
              value={filters.endDate}
              onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))}
            />
            <button className="btn btn--primary" type="button" onClick={handleApplyFilters}>Appliquer le filtre</button>
          </div>
        </div>

        {error && <p className="source-error" role="alert">{error}</p>}
        {loading && <p role="status">Chargement des lignes soumises…</p>}
        <div className="quality-list">
          {rows.map((row) => (
            <div key={row.id} className="quality-item">
              <div className="quality-item__top">
                <span>{row.block}</span>
                <span>Ligne {row.line}</span>
              </div>
              <div className="quality-item__meta">
                <span>EAN13 : {row.ean}</span>
                <span>Produit : {row.product}</span>
                <span>Spécialité : {row.speciality}</span>
              </div>
              <div className="quality-item__meta">
                <span>{row.date} {row.time}</span>
                <span>Agent : {row.agent}</span>
                <span>Rôle : {getRoleLabel(row.role)}</span>
              </div>
              {row.errors.length > 0 && (
                <ul className="quality-item__errors">
                  {row.errors.map((validationError, index) => (
                    <li key={`${validationError.field}-${index}`}>{validationError.field}: {validationError.message}</li>
                  ))}
                </ul>
              )}
              {(user?.role === "ADMIN" || user?.role === "SUPERVISEUR") && (
                <label className="quality-item__comment">
                  <span>Retours et correction</span>
                  <textarea
                    className="control"
                    value={feedbackByRow[row.sourceRow] ?? ""}
                    onChange={(event) => setFeedbackByRow((current) => ({ ...current, [row.sourceRow]: event.target.value }))}
                    maxLength={2000}
                    placeholder="Saisir un retour…"
                  />
                </label>
              )}
              <div className="quality-item__actions">
                {(user?.role === "ADMIN" || user?.role === "SUPERVISEUR") && <button
                  className="btn btn--primary quality-item__send"
                  type="button"
                  disabled={sendingRow === row.sourceRow || !(feedbackByRow[row.sourceRow] ?? "").trim()}
                  onClick={() => sendFeedback(row)}
                >
                  {sendingRow === row.sourceRow ? "Envoi…" : "Envoyer le retour"}
                </button>}
                <button className="btn" type="button" onClick={() => handleSendReturn(row)}>Ouvrir la ligne</button>
              </div>
            </div>
          ))}
          {!loading && !error && rows.length === 0 && (
            <p className="statistics-empty">Aucune ligne soumise ne correspond aux filtres.</p>
          )}
          {!loading && hasMore && (
            <button className="btn" type="button" disabled={loadingMore} onClick={() => loadTreatments(page + 1, true)}>
              {loadingMore ? "Chargement…" : "Charger les 100 lignes suivantes"}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

function DataPage({ users = [] }) {
  const [filters, setFilters] = useState(() => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 29);
    return { startDate: formatDateInput(start), endDate: formatDateInput(end), role: "", agent: "" };
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [performance, setPerformance] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exportFormat, setExportFormat] = useState("excel");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportResult, setExportResult] = useState(null);

  const exportSubmittedData = async () => {
    setExporting(true);
    setExportError("");
    setExportResult(null);
    try {
      const query = new URLSearchParams({ format: exportFormat });
      if (appliedFilters.startDate) query.set("from", appliedFilters.startDate);
      if (appliedFilters.endDate) query.set("to", appliedFilters.endDate);
      if (appliedFilters.role) query.set("role", appliedFilters.role);
      if (appliedFilters.agent.trim()) query.set("agent", appliedFilters.agent.trim());
      const response = await authenticatedFetch(`/api/sheets/export?${query}`, {
        method: "POST",
      });
      if (!response.ok) {
        let details = `Erreur ${response.status}`;
        try {
          const body = await response.json();
          details = body.error ?? body.errors?.[0]?.message ?? details;
        } catch {
          // The generic client message is still displayed when the response isn't JSON.
        }
        throw new Error(details);
      }

      if (exportFormat === "google-sheets") {
        const body = await response.json();
        if (typeof body.url !== "string") throw new Error("Le lien de la copie Google Sheets est absent.");
        setExportResult({ url: body.url, count: body.count });
      } else {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `saisies-confiserie-${formatDateInput(new Date())}.xlsx`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
        setExportResult({ count: Number(response.headers.get("X-Exported-Rows") ?? 0), downloaded: true });
      }
    } catch (exportFailure) {
      setExportError(userErrorMessage("submitted-data-export", exportFailure));
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      try {
        const query = new URLSearchParams();
        if (appliedFilters.startDate) query.set("from", appliedFilters.startDate);
        if (appliedFilters.endDate) query.set("to", appliedFilters.endDate);
        const response = await fetch(`/api/v1/stats/agents?${query}`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok || !body.success) {
          throw new Error(body.errors?.[0]?.message ?? `Erreur ${response.status}`);
        }
        setPerformance(body.data.agents ?? []);
        setError("");
      } catch (loadError) {
        if (loadError.name !== "AbortError") setError(userErrorMessage("agent-statistics-load", loadError));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    load();
    return () => controller.abort();
  }, [appliedFilters.startDate, appliedFilters.endDate]);

  const filteredRows = useMemo(() => {
    const usersById = new Map(users.map((entry) => [String(entry.id), entry]));
    return performance.flatMap((agent) => {
      const profile = usersById.get(String(agent.actorId));
      const fullName = profile?.fullName || `${profile?.firstName ?? ""} ${profile?.lastName ?? ""}`.trim() || profile?.login || "Agent";
      if (appliedFilters.role && profile?.role !== appliedFilters.role) return [];
      if (appliedFilters.agent && !fullName.toLowerCase().includes(appliedFilters.agent.trim().toLowerCase())) return [];
      return agent.daily.map((day) => ({
        date: day.date,
        lines: day.validatedLines,
        returns: day.correctedReturns ?? 0,
        agent: fullName,
        agentId: agent.actorId,
        role: profile?.role ?? "AGENT",
      }));
    }).sort((left, right) => right.date.localeCompare(left.date) || left.agent.localeCompare(right.agent));
  }, [performance, users, appliedFilters.role, appliedFilters.agent]);
  const invalidRange = filters.startDate && filters.endDate && filters.startDate > filters.endDate;

  return (
    <main className="page-shell">
      <section className="panel">
        <div className="panel__header panel__header--stacked">
          <h2>Page de Données</h2>
          <section className="data-export">
            <div>
              <h3>Exporter les saisies filtrées</h3>
              <p>L’export conserve uniquement les lignes correspondant aux filtres appliqués (période, rôle et agent). Le nom de l’agent apparaît dans la colonne NOM, avec la date de traitement et le numéro de ligne source pour faciliter le rapprochement. Si les filtres couvrent toutes les soumissions exportables, le classeur complet est conservé. Les brouillons, corrections demandées et lignes rejetées sont exclus ; l’original n’est jamais modifié.</p>
            </div>
            <div className="toolbar data-export__controls">
              <label className="data-export__format">
                <span>Format d’extraction</span>
                <select className="control" value={exportFormat} onChange={(event) => setExportFormat(event.target.value)}>
                  <option value="excel">Fichier Excel (.xlsx)</option>
                  <option value="google-sheets">Copie Google Sheets</option>
                </select>
              </label>
              <button className="btn btn--primary" type="button" disabled={exporting} onClick={exportSubmittedData}>
                {exporting ? "Préparation de l’export…" : "Exporter les saisies"}
              </button>
            </div>
            {exportError && <p className="source-error" role="alert">{exportError}</p>}
            {exportResult?.downloaded && (
              <p className="data-export__success" role="status">Le fichier Excel a été téléchargé ({exportResult.count} lignes filtrées).</p>
            )}
            {exportResult?.url && (
              <p className="data-export__success" role="status">
                Copie Google Sheets créée ({exportResult.count} lignes filtrées). Son accès dépend des autorisations du dossier Google Drive de destination.{" "}
                <a href={exportResult.url} target="_blank" rel="noreferrer">Ouvrir la copie</a>
              </p>
            )}
          </section>
          <div className="toolbar toolbar--wide">
            <input
              className="control"
              type="date"
              value={filters.startDate}
              onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))}
            />
            <input
              className="control"
              type="date"
              value={filters.endDate}
              onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))}
            />
            <select
              className="control"
              value={filters.role}
              onChange={(event) => setFilters((current) => ({ ...current, role: event.target.value }))}
            >
              <option value="">Tous les rôles</option>
              <option value="AGENT">Agent</option>
              <option value="SUPERVISEUR">Superviseur</option>
              <option value="ADMIN">Admin</option>
            </select>
            <input
              className="control"
              type="text"
              placeholder="Agent"
              value={filters.agent}
              onChange={(event) => setFilters((current) => ({ ...current, agent: event.target.value }))}
            />
            <button className="btn btn--primary" type="button" disabled={Boolean(invalidRange)} onClick={() => setAppliedFilters(filters)}>Appliquer le filtre</button>
          </div>
        </div>

        <h3 className="data-section-title">Statistiques par agent</h3>
        {error && <p className="source-error" role="alert">{error}</p>}
        {invalidRange && <p className="source-error" role="alert">La date de début doit précéder la date de fin.</p>}
        {loading && <p role="status">Chargement des données…</p>}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Lignes validées</th>
                <th>Retours</th>
                <th>Agent</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={`${row.agentId}-${row.date}`}>
                  <td>{row.date}</td>
                  <td>{row.lines}</td>
                  <td>{row.returns}</td>
                  <td>{row.agent}</td>
                </tr>
              ))}
              {!loading && !error && filteredRows.length === 0 && (
                <tr><td colSpan="4">Aucune donnée ne correspond aux filtres.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function UserManagementPage({ users, setUsers, currentUser }) {
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const filteredUsers = users.filter((user) => `${user.firstName} ${user.lastName}`.toLowerCase().includes(search.toLowerCase()));

  const handleDelete = async (user) => {
    const confirmed = window.confirm(`Voulez-vous vraiment supprimer ${user.fullName} ?`);
    if (!confirmed) return;
    try {
      const response = await authenticatedFetch(`/api/v1/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.errors?.[0]?.message ?? "Suppression refusée");
      setUsers((current) => current.filter((item) => String(item.id) !== String(user.id)));
    } catch (deleteError) { setError(deleteError.message); }
  };

  const handleSave = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const userValues = {
      firstName: form.get("firstName"),
      lastName: form.get("lastName"),
      login: form.get("login"),
      password: form.get("password"),
      role: form.get("role"),
    };
    try {
      setError("");
      const response = await authenticatedFetch(selectedUser ? `/api/v1/users/${encodeURIComponent(selectedUser.id)}` : "/api/v1/users", {
        method: selectedUser ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userValues),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.errors?.[0]?.message ?? "Enregistrement refusé");
      const savedUser = body.data.user;
      setUsers((current) => selectedUser
        ? current.map((item) => String(item.id) === String(savedUser.id) ? savedUser : item)
        : [...current, savedUser]);
      setSelectedUser(null);
      setShowForm(false);
      formElement.reset();
    } catch (saveError) { setError(saveError.message); }
  };

  return (
    <main className="page-shell">
      <section className="panel">
        <div className="panel__header panel__header--stacked">
          <h2>Gestion des Utilisateurs</h2>
          <div className="toolbar">
            <input
              className="control"
              type="search"
              placeholder="Rechercher un utilisateur"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button className="btn btn--primary" type="button" onClick={() => {
              setSelectedUser(null);
              setShowForm(true);
            }}>
              Ajouter un nouvel utilisateur
            </button>
          </div>
        </div>
        {error && <p className="source-error" role="alert">{error}</p>}

        <div className="user-list">
          {filteredUsers.map((user) => (
            <div key={user.id} className="user-card">
              {currentUser.role === "ADMIN" ? (
                <button type="button" className="user-link" onClick={() => {
                  setSelectedUser(user);
                  setShowForm(true);
                }}>
                  {user.fullName}
                </button>
              ) : <strong>{user.fullName}</strong>}
              <div className="user-card__meta">
                <span>{getRoleLabel(user.role)}</span>
                <span>{user.login}</span>
              </div>
              {currentUser.role === "ADMIN" && <button className="btn btn--danger" type="button" onClick={() => handleDelete(user)}>Supprimer</button>}
            </div>
          ))}
        </div>
      </section>

      {showForm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3>{selectedUser ? "Modifier l’utilisateur" : "Ajouter un utilisateur"}</h3>
            <form onSubmit={handleSave} className="form-grid">
              <label className="field">
                <span>Nom</span>
                <input name="lastName" className="control" defaultValue={selectedUser?.lastName ?? ""} required />
              </label>
              <label className="field">
                <span>Prénom</span>
                <input name="firstName" className="control" defaultValue={selectedUser?.firstName ?? ""} required />
              </label>
              <label className="field">
                <span>Login</span>
                <input name="login" className="control" defaultValue={selectedUser?.login ?? ""} required />
              </label>
              <label className="field">
                <span>Mot de passe{selectedUser ? " (vide pour conserver l’actuel)" : ""}</span>
                <input
                  name="password"
                  className="control"
                  type="password"
                  autoComplete="new-password"
                  placeholder={selectedUser ? "Saisir un nouveau mot de passe" : ""}
                  minLength={8}
                  required={!selectedUser}
                />
              </label>
              <label className="field">
                <span>Rôle</span>
                <select name="role" className="control" defaultValue={selectedUser?.role ?? "AGENT"}>
                  <option value="AGENT">Agent</option>
                  {currentUser.role === "ADMIN" && <>
                    <option value="SUPERVISEUR">Superviseur</option>
                    <option value="ADMIN">Admin</option>
                  </>}
                </select>
              </label>
              <div className="form-actions">
                <button className="btn" type="button" onClick={() => setShowForm(false)}>Annuler</button>
                <button className="btn btn--primary" type="submit">{selectedUser ? "Modifier" : "Ajouter"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

function GoogleSheetConnectionPage() {
  const [sheetUrl, setSheetUrl] = useState("");
  const [connection, setConnection] = useState(null);
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async (event) => {
    event.preventDefault();
    setConnecting(true);
    setConnection(null);
    try {
      const response = await authenticatedFetch("/api/sheets/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sheetUrl }),
      });
      const body = await response.json();
      if (!response.ok || !body.connected) throw new Error(body.error ?? `Erreur ${response.status}`);
      setConnection({ success: true, message: `Classeur connecté : ${body.rowCount} lignes de données disponibles.` });
    } catch (error) {
      setConnection({ success: false, message: error.message });
    } finally {
      setConnecting(false);
    }
  };

  return (
    <main className="page-shell">
      <section className="panel">
        <h2>Connexion Google Sheets</h2>
        <p>Les identifiants du compte de service sont utilisés côté serveur. Les lignes de distribution seront chargées depuis le classeur connecté.</p>
        <form className="sheet-connection-form" onSubmit={handleConnect}>
          <label className="field">
            <span>Lien du fichier Google Sheets</span>
            <input
              className="control"
              type="url"
              value={sheetUrl}
              onChange={(event) => setSheetUrl(event.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              required
            />
          </label>
          <button className="btn btn--primary" type="submit" disabled={connecting}>
            {connecting ? "Connexion…" : "Connecter le fichier"}
          </button>
        </form>
        <p className="sheet-connection-note">La connexion saisie est conservée jusqu’au redémarrage du serveur Vite.</p>
        {connection && (
          <p className={connection.success ? "sheet-connection-success" : "source-error"} role={connection.success ? "status" : "alert"}>
            {connection.message}
          </p>
        )}
      </section>
    </main>
  );
}

function LoginPage({ onLogin }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ login, password }),
      });
      let body;
      try {
        body = await response.json();
      } catch {
        if (response.status >= 500) {
          throw new Error("Le service de connexion est indisponible. Vérifiez que le backend peut joindre MongoDB.");
        }
        throw new Error("Le service de connexion a renvoyé une réponse invalide. Réessaie.");
      }
      if (!response.ok || !body.success) {
        throw new Error(body.errors?.[0]?.message ?? "Connexion refusée");
      }
      onLogin(body.data.user);
    } catch (loginError) {
      setError(loginError instanceof TypeError
        ? "Impossible de joindre le service de connexion. Vérifiez que le backend est démarré."
        : loginError.message || "Connexion impossible. Réessaie.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <div className="login-card">
        <h1>Connexion</h1>
        <form onSubmit={handleSubmit} className="login-form">
          <label className="field">
            <span>Login</span>
            <input className="control" type="text" value={login} onChange={(event) => setLogin(event.target.value)} required />
          </label>
          <label className="field">
            <span>Mot de passe</span>
            <input className="control" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          {error && <p className="field-error">{error}</p>}
          <button className="btn btn--primary" type="submit" disabled={submitting}>{submitting ? "Connexion…" : "Se connecter"}</button>
        </form>
      </div>
    </main>
  );
}

function Application() {
  const [storageMode, setStorageMode] = useState("checking");
  const [users, setUsers] = useState([]);
  const [user, setUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [notifications, setNotifications] = useState(() => {
    try {
      const savedNotifications = JSON.parse(window.localStorage.getItem("chocolat-notifications") ?? "null");
      return Array.isArray(savedNotifications) && savedNotifications.every((item) => item.message)
        ? savedNotifications
        : defaultNotifications;
    } catch {
      return defaultNotifications;
    }
  });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/health", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error("API indisponible");
        setStorageMode(body.data.storageMode);
      })
      .catch((error) => {
        if (error.name !== "AbortError") setStorageMode("unavailable");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/auth/me", { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        const body = await response.json();
        return body.success ? body.data.user : null;
      })
      .then((authenticatedUser) => {
        if (controller.signal.aborted) return;
        setUser(authenticatedUser);
        if (authenticatedUser && ["ADMIN", "SUPERVISEUR"].includes(authenticatedUser.role)) {
          return fetch("/api/v1/users", { credentials: "same-origin", signal: controller.signal })
            .then((response) => response.json())
            .then((body) => { if (body.success) setUsers(body.data.users); });
        }
        setUsers(authenticatedUser ? [authenticatedUser] : []);
      })
      .catch((error) => { if (error.name !== "AbortError") setUser(null); })
      .finally(() => { if (!controller.signal.aborted) setAuthChecking(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    window.localStorage.setItem("chocolat-notifications", JSON.stringify(notifications));
  }, [notifications]);

  const saveDraft = async (sourceIndex, values, submit = false) => {
    const sourceRow = sourceIndex + 1;
    const response = await authenticatedFetch("/api/v1/data/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceRow, values, submit }),
    });
    const body = await response.json();
    if (!response.ok || !body.success) {
      throw new Error(body.errors?.[0]?.message ?? `Erreur ${response.status}`);
    }

    setStorageMode(body.data.storageMode);
    const storageLabel = body.data.storageMode === "mongodb"
      ? "MongoDB"
      : body.data.storageMode === "memory"
        ? "la mémoire temporaire (données non persistantes)"
        : "un stockage non identifié";
    const action = submit ? "Saisie validée" : "Brouillon";
    return `${action} de l’index ${sourceIndex} (ligne ${sourceRow} du Google Sheet) enregistré (version ${body.data.version}) dans ${storageLabel}.`;
  };

  const saveDistributionGroupStatus = async (groupStart, status) => {
    const response = await authenticatedFetch(`/api/v1/distribution-groups/${groupStart}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const body = await response.json();
    if (!response.ok || !body.success) {
      throw new Error(body.errors?.[0]?.message ?? `Erreur ${response.status}`);
    }
    return body.data.group;
  };

  const loadDistributionGroupStatuses = useCallback(async ({ signal } = {}) => {
    const response = await authenticatedFetch("/api/v1/distribution-groups", { signal });
    const body = await response.json();
    if (!response.ok || !body.success) {
      throw new Error(body.errors?.[0]?.message ?? `Erreur ${response.status}`);
    }
    return body.data.groups;
  }, []);

  const handleLogout = async () => {
    try {
      const response = await authenticatedFetch("/api/v1/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Déconnexion refusée par le serveur");
    } catch {
      window.alert("La déconnexion n’a pas pu être confirmée par le serveur. Réessaie lorsque la connexion sera rétablie.");
      return;
    }
    setUser(null);
    setUsers([]);
    setNotifications(defaultNotifications);
  };

  const handleLogin = async (authenticatedUser) => {
    setUser(authenticatedUser);
    if (["ADMIN", "SUPERVISEUR"].includes(authenticatedUser.role)) {
      try {
        const response = await fetch("/api/v1/users", { credentials: "same-origin" });
        const body = await response.json();
        if (body.success) setUsers(body.data.users);
      } catch { setUsers([]); }
    } else setUsers([authenticatedUser]);
  };

  const renderAuthenticatedRoutes = () => (
    <>
      <Route path="/" element={<Navigate to="/accueil" replace />} />
      <Route path="/login" element={<Navigate to="/accueil" replace />} />
      <Route path="/accueil" element={<AppShell user={user} notifications={notifications} onLogout={handleLogout}><HomePage user={user} storageMode={storageMode} /></AppShell>} />
      <Route path="/distribution" element={<AppShell user={user} notifications={notifications} onLogout={handleLogout}><DistributionHomePage onLoadGroupStatuses={loadDistributionGroupStatuses} onSaveGroupStatus={saveDistributionGroupStatus} /></AppShell>} />
      <Route path="/distribution/groupe/:groupStart" element={<AppShell user={user} notifications={notifications} onLogout={handleLogout}><DistributionGroupPage /></AppShell>} />
      <Route path="/distribution/groupe/:groupStart/ligne/:index" element={<AppShell user={user} notifications={notifications} onLogout={handleLogout}><DistributionLinePage storageMode={storageMode} onSave={saveDraft} /></AppShell>} />
      <Route path="/qualite" element={<AppShell user={user} notifications={notifications} onLogout={handleLogout}><QualityPage users={users} user={user} /></AppShell>} />
      <Route path="/statistiques" element={<AppShell user={user} notifications={notifications} onLogout={handleLogout}><StatisticsPage users={users} user={user} /></AppShell>} />
      {(user.role === "SUPERVISEUR" || user.role === "ADMIN") && (
        <>
          <Route path="/donnees" element={<AppShell user={user} notifications={notifications} onLogout={handleLogout}><DataPage users={users} /></AppShell>} />
        </>
      )}
      {(user.role === "ADMIN" || user.role === "SUPERVISEUR") && (
        <Route path="/utilisateurs" element={<AppShell user={user} notifications={notifications} onLogout={handleLogout}><UserManagementPage users={users} setUsers={setUsers} currentUser={user} /></AppShell>} />
      )}
      {user.role === "ADMIN" && (
        <>
          <Route path="/connexion-sheet" element={<AppShell user={user} notifications={notifications} onLogout={handleLogout}><GoogleSheetConnectionPage /></AppShell>} />
          <Route path="/monitoring" element={<AppShell user={user} notifications={notifications} onLogout={handleLogout}><MonitoringPage storageMode={storageMode} /></AppShell>} />
        </>
      )}
      <Route path="*" element={<Navigate to="/accueil" replace />} />
    </>
  );

  if (authChecking) return <main className="login-page"><p role="status">Vérification de la session…</p></main>;

  return (
    <div className="wrap">
      <Routes>
        {!user ? (
          <>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </>
        ) : renderAuthenticatedRoutes()}
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Application />
    </BrowserRouter>
  );
}
