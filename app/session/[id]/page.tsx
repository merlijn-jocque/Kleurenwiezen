// app/session/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useParams, useRouter } from "next/navigation";

/* ================= TYPES ================= */

type Player = { id: string; name: string };
type Session = { id: string; title: string; group_id: string };

type Choice =
  | "ENKEL"
  | "DUBBEL"
  | "TROEL"
  | "ABONDANCE"
  | "KLEINE_MISERE"
  | "GROTE_MISERE"
  | "SOLO_SLIM";

type Note = { id: string; body: string; created_at: string };

/* ================= HELPERS ================= */

function winnerRange(choice: Choice) {
  if (choice === "DUBBEL" || choice === "TROEL") return { min: 2, max: 2 };
  if (choice === "KLEINE_MISERE") return { min: 1, max: 3 };
  if (choice === "GROTE_MISERE") return { min: 1, max: 3 };
  return { min: 1, max: 1 };
}

function labelChoice(c: string) {
  return (
    {
      ENKEL: "Enkel",
      DUBBEL: "Dubbel",
      TROEL: "Troel",
      ABONDANCE: "Abondance",
      KLEINE_MISERE: "Kleine misère",
      GROTE_MISERE: "Grote misère",
      SOLO_SLIM: "Solo slim",
    } as Record<string, string>
  )[c] ?? c;
}

/* ================= SCORE ENGINE ================= */

/**
 * Negatieve overslagen:
 *  - Dubbel: o=0 => +2 ; o=+1 => +3 ; o=-1 => -3 ; o=-2 => -4 ; o=-3 => -5 ...
 *    => winnaarPerSpeler = (o>=0 ? 2+o : -(2+abs(o))) ; verliezerPerSpeler = -winnaarPerSpeler
 *
 *  - Troel: "dubbel alles": o=0 => +4 ; o=+1 => +6 ; o=-1 => -6 ; o=-2 => -8 ...
 *    => winnaarPerSpeler = (o>=0 ? 4+2o : -(4+2abs(o))) ; verliezerPerSpeler = -winnaarPerSpeler
 *
 *  - Enkel: gebalanceerd 1 vs 3:
 *    => winnaar = (o>=0 ? 6+3o : -(6+3abs(o)))
 *    => verliezers elk = -winnaar/3 (moet integer blijven)
 *
 * Misères: totaal +12/-12 of +24/-24 verdeeld over winnaars/verliezers.
 */
function computePoints(
  players: { id: string }[],
  choice: Choice,
  winnerIds: string[],
  overslagen: number,
  mult: number
) {
  if (players.length !== 4) throw new Error("Deze puntentabel verwacht 4 spelers.");

  const { min, max } = winnerRange(choice);
  if (winnerIds.length < min || winnerIds.length > max) {
    throw new Error(`Selecteer ${min === max ? min : `${min} t.e.m. ${max}`} winnaar(s).`);
  }

  const isWinner = (pid: string) => winnerIds.includes(pid);
  const losers = 4 - winnerIds.length;
  if (losers <= 0) throw new Error("Minstens 1 verliezer nodig.");

  const o = Number.isFinite(overslagen) ? overslagen : 0;
  const multiplier = Math.max(1, mult || 1);

  const out: Record<string, number> = {};

  // Misère (verdeling)
  if (choice === "KLEINE_MISERE" || choice === "GROTE_MISERE") {
    const total = choice === "KLEINE_MISERE" ? 12 : 24;

    const winPts = total / winnerIds.length;
    const losePts = -total / losers;

    if (!Number.isInteger(winPts) || !Number.isInteger(losePts)) {
      throw new Error("Misère verdeling niet geldig (kies andere winnaars).");
    }

    for (const p of players) out[p.id] = isWinner(p.id) ? winPts : losePts;
  } else {
    if (choice === "DUBBEL") {
      const win = o >= 0 ? 2 + o : -(2 + Math.abs(o));
      const lose = -win;
      for (const p of players) out[p.id] = isWinner(p.id) ? win : lose;
    } else if (choice === "TROEL") {
      const win = o >= 0 ? 4 + 2 * o : -(4 + 2 * Math.abs(o));
      const lose = -win;
      for (const p of players) out[p.id] = isWinner(p.id) ? win : lose;
    } else if (choice === "ENKEL") {
      const win = o >= 0 ? 6 + 3 * o : -(6 + 3 * Math.abs(o));
      const lose = -win / 3;
      if (!Number.isInteger(lose)) {
        throw new Error("Ongeldige enkel-verdeling (geen geheel getal voor verliezers).");
      }
      for (const p of players) out[p.id] = isWinner(p.id) ? win : lose;
    } else {
      // Vaste waarden
      let baseWin = 0;
      let baseLose = 0;

      switch (choice) {
        case "ABONDANCE":
          baseWin = 18;
          baseLose = -6;
          break;
        case "SOLO_SLIM":
          baseWin = 48;
          baseLose = -16;
          break;
        default:
          baseWin = 0;
          baseLose = 0;
          break;
      }

      for (const p of players) out[p.id] = isWinner(p.id) ? baseWin : baseLose;
    }
  }

  for (const k of Object.keys(out)) out[k] *= multiplier;

  const sum = Object.values(out).reduce((a, b) => a + b, 0);
  if (sum !== 0) throw new Error(`Som = ${sum}, niet 0.`);
  return out;
}

/* ================= SMALL SVG CHART HELPERS ================= */

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}
function buildLinePath(xs: number[], ys: number[]) {
  if (xs.length === 0) return "";
  let d = `M ${xs[0]} ${ys[0]}`;
  for (let i = 1; i < xs.length; i++) d += ` L ${xs[i]} ${ys[i]}`;
  return d;
}

/* ================= PAGE ================= */

export default function SessionPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const [session, setSession] = useState<Session | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [roundNo, setRoundNo] = useState(1);

  const [rounds, setRounds] = useState<
    { id: string; no: number; choice: string; items: { name: string; points: number }[] }[]
  >([]);

  // input
  const [choice, setChoice] = useState<Choice>("ENKEL");
  const [winnerIds, setWinnerIds] = useState<string[]>([]);
  const [overslagen, setOverslagen] = useState(0);

  // multipliers
  const [pass, setPass] = useState(false); // x2
  const [pass2, setPass2] = useState(false); // x4
  const [fullRound, setFullRound] = useState(false); // x2

  const [preview, setPreview] = useState<Record<string, number>>({});
  const [inputError, setInputError] = useState<string | null>(null);

  // ✅ Notes (los van rondes)
  const [noteText, setNoteText] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteStatus, setNoteStatus] = useState<string>("");

  // ✅ Note edit state (voor “Aanpassen”)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  async function getGroupId() {
    const code = localStorage.getItem("kw_join_code");
    if (!code) {
      router.push("/join");
      return null;
    }
    const { data } = await supabase.from("groups").select("id").eq("join_code", code).single();
    return data?.id ?? null;
  }

  useEffect(() => {
    (async () => {
      const gid = await getGroupId();
      if (!gid) return;

      const { data: s } = await supabase
        .from("sessions")
        .select("id,title,group_id")
        .eq("id", sessionId)
        .single();

      if (!s || s.group_id !== gid) return;

      setSession(s);

      const { data: pl } = await supabase
        .from("players")
        .select("id,name")
        .eq("group_id", gid)
        .order("name");

      setPlayers(pl ?? []);
      await loadRounds(pl ?? []);
      await loadNotes();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // preview
  useEffect(() => {
    try {
      setInputError(null);
      const mult = (pass ? 2 : 1) * (pass2 ? 4 : 1) * (fullRound ? 2 : 1);
      const pts = computePoints(players, choice, winnerIds, overslagen, mult);
      setPreview(pts);
    } catch (e: any) {
      setPreview({});
      setInputError(e?.message ?? "Ongeldige input");
    }
  }, [players, choice, winnerIds, overslagen, pass, pass2, fullRound]);

  async function loadRounds(pl: Player[]) {
    const { data: rs } = await supabase
      .from("rounds")
      .select("id,round_no,choice")
      .eq("session_id", sessionId)
      .order("round_no");

    if (!rs || rs.length === 0) {
      setRounds([]);
      setRoundNo(1);
      return;
    }

    setRoundNo(rs[rs.length - 1].round_no + 1);

    const ids = rs.map((r: any) => r.id);

    const { data: sc } = await supabase
      .from("scores")
      .select("round_id,player_id,points")
      .in("round_id", ids);

    const byRound: Record<string, Record<string, number>> = {};
    (sc ?? []).forEach((x: any) => {
      byRound[x.round_id] ??= {};
      byRound[x.round_id][x.player_id] = x.points;
    });

    const out = rs.map((r: any) => ({
      id: r.id,
      no: r.round_no,
      choice: r.choice ?? "",
      items: pl.map((p) => ({
        name: p.name,
        points: byRound[r.id]?.[p.id] ?? 0,
      })),
    }));

    setRounds(out);
  }

  async function loadNotes() {
    const { data, error } = await supabase
      .from("session_notes")
      .select("id,body,created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false });

    if (error) {
      setNoteStatus("Fout bij laden notes: " + error.message);
      return;
    }
    setNotes((data ?? []) as Note[]);
    setNoteStatus("");
  }

  async function saveNote() {
    const body = noteText.trim();
    if (!body) return;

    setNoteStatus("Opslaan...");
    const { error } = await supabase.from("session_notes").insert({
      session_id: sessionId,
      body,
    });

    if (error) {
      setNoteStatus("Fout bij opslaan: " + error.message);
      return;
    }

    setNoteText("");
    setEditingNoteId(null);
    setNoteStatus("");
    await loadNotes();
  }

  // ✅ Update bestaande note
    async function updateNote() {
  if (!editingNoteId) return;
  
  const body = noteText.trim();
  if (!body) return;

  setNoteStatus("Aanpassen...");

  const { error } = await supabase
    .from("session_notes")
    .update({ body })
    .eq("id", editingNoteId)
    .eq("session_id", sessionId);
    
  if (error) {
    setNoteStatus("Fout bij aanpassen: " + error.message);
    return;
  }

  // reset editor
  setEditingNoteId(null);
  setNoteText("");
  setNoteStatus("");

  await loadNotes();
}

  async function deleteNote(id: string) {
    const ok = confirm("Deze note verwijderen?");
    if (!ok) return;

    const { error } = await supabase.from("session_notes").delete().eq("id", id);
    if (error) {
      alert("Fout bij verwijderen: " + error.message);
      return;
    }

    if (editingNoteId === id) {
      setEditingNoteId(null);
      setNoteText("");
    }

    await loadNotes();
  }

  // ✅ ronde deleten (rondes + scores)
  async function deleteRound(roundId: string) {
    const ok = confirm("Deze ronde verwijderen? (scores worden ook verwijderd)");
    if (!ok) return;

    const { error: scErr } = await supabase.from("scores").delete().eq("round_id", roundId);
    if (scErr) {
      alert("Fout bij verwijderen scores: " + scErr.message);
      return;
    }

    const { error: rErr } = await supabase.from("rounds").delete().eq("id", roundId);
    if (rErr) {
      alert("Fout bij verwijderen ronde: " + rErr.message);
      return;
    }

    await loadRounds(players);
  }

  function toggleWinner(pid: string) {
    const { max } = winnerRange(choice);
    setWinnerIds((prev) => {
      if (prev.includes(pid)) return prev.filter((x) => x !== pid);
      if (prev.length >= max) return prev;
      return [...prev, pid];
    });
  }

  async function saveRound() {
    if (!session) return;

    try {
      const mult = (pass ? 2 : 1) * (pass2 ? 4 : 1) * (fullRound ? 2 : 1);
      const points = computePoints(players, choice, winnerIds, overslagen, mult);

      const { data: r, error: rErr } = await supabase
        .from("rounds")
        .insert({
          session_id: sessionId,
          round_no: roundNo,
          choice,
          overslagen: choice === "ENKEL" || choice === "DUBBEL" || choice === "TROEL" ? overslagen : 0,
          mult,
        })
        .select("id")
        .single();

      if (rErr || !r) {
        alert("Fout bij ronde: " + (rErr?.message ?? "geen details"));
        return;
      }

      const { error: sErr } = await supabase.from("scores").insert(
        players.map((p) => ({
          round_id: r.id,
          player_id: p.id,
          points: points[p.id],
        }))
      );

      if (sErr) {
        alert("Fout bij scores: " + sErr.message);
        return;
      }

      // reset
      setWinnerIds([]);
      setOverslagen(0);
      setPass(false);
      setPass2(false);
      setFullRound(false);

      await loadRounds(players);
    } catch (e: any) {
      alert(e?.message ?? "Fout bij opslaan");
    }
  }

  const totalForName = (name: string) =>
    rounds.reduce((sum, r) => sum + (r.items.find((i) => i.name === name)?.points ?? 0), 0);

  const totalColor = (n: number) => (n > 0 ? "green" : n < 0 ? "crimson" : "inherit");

  // ---- Layout constants (mobiel vriendelijk) ----
  const SCORE_COL_WIDTH = 96;
  const GAP_AFTER_LAST_PLAYER = 80;
  const CHOICE_COL_WIDTH = 190;

  /* ================= CHART (cumulative totals per round) ================= */

  const chart = useMemo(() => {
    const labels = rounds.map((r) => r.no);
    const playerNames = players.map((p) => p.name);

    const series: Record<string, number[]> = {};
    for (const name of playerNames) series[name] = [];

    const running: Record<string, number> = {};
    for (const name of playerNames) running[name] = 0;

    for (const r of rounds) {
      for (const name of playerNames) {
        const val = r.items.find((i) => i.name === name)?.points ?? 0;
        running[name] += val;
        series[name].push(running[name]);
      }
    }

    let minY = 0;
    let maxY = 0;
    for (const name of playerNames) {
      for (const v of series[name] ?? []) {
        minY = Math.min(minY, v);
        maxY = Math.max(maxY, v);
      }
    }
    if (minY === maxY) {
      minY -= 1;
      maxY += 1;
    }

    return { labels, playerNames, series, minY, maxY };
  }, [rounds, players]);

  const CHART_H = 320; // ✅ dubbel zo hoog
  const COLORS = ["#111827", "#2563eb", "#16a34a", "#dc2626"]; // 4 lijnen

  return (
    <div style={{ padding: 24, maxWidth: 900, fontFamily: "system-ui" }}>
      <button onClick={() => router.push("/")}>← Terug</button>

      <h1 style={{ fontWeight: 800, fontSize: 28, marginBottom: 6 }}>{session?.title ?? "Avond"}</h1>

      {/* Nieuwe ronde badge */}
      <div
        style={{
          display: "inline-flex",
          gap: 10,
          marginBottom: 10,
          padding: "6px 12px",
          borderRadius: 999,
          border: "1px solid #ddd",
          background: "#fafafa",
          fontWeight: 700,
        }}
      >
        Nieuwe ronde <span style={{ fontWeight: 800 }}>#{roundNo}</span>
      </div>

      <div style={{ display: "grid", gap: 12, maxWidth: 560 }}>
        {/* Keuze */}
        <div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Keuze</div>
          <select
            value={choice}
            onChange={(e) => {
              setChoice(e.target.value as Choice);
              setWinnerIds([]);
              setOverslagen(0);
              setPass(false);
              setPass2(false);
              setFullRound(false);
            }}
            style={{
              width: "100%",
              padding: 8,
              borderRadius: 10,
              border: "1px solid #ccc",
            }}
          >
            <option value="ENKEL">Enkel</option>
            <option value="DUBBEL">Dubbel</option>
            <option value="TROEL">Troel</option>
            <option value="ABONDANCE">Abondance</option>
            <option value="KLEINE_MISERE">Kleine misère</option>
            <option value="GROTE_MISERE">Grote misère</option>
            <option value="SOLO_SLIM">Solo slim</option>
          </select>
        </div>

        {/* Overslagen (negatief toegestaan) */}
        {(choice === "ENKEL" || choice === "DUBBEL" || choice === "TROEL") && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Overslagen</div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={() => setOverslagen((o) => o - 1)}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  border: "1px solid #ccc",
                  background: "#fafafa",
                  fontSize: 20,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
                aria-label="Overslagen min 1"
              >
                −
              </button>

              <input
                type="number"
                inputMode="numeric"
                value={overslagen}
                onChange={(e) => setOverslagen(parseInt(e.target.value || "0", 10))}
                style={{
                  width: 90,
                  textAlign: "center",
                  padding: 10,
                  borderRadius: 10,
                  border: "1px solid #ccc",
                  fontSize: 16,
                }}
              />

              <button
                type="button"
                onClick={() => setOverslagen((o) => o + 1)}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  border: "1px solid #ccc",
                  background: "#fafafa",
                  fontSize: 20,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
                aria-label="Overslagen plus 1"
              >
                +
              </button>
            </div>
          </div>
        )}

        {/* Multipliers */}
        <div style={{ display: "grid", gap: 6 }}>
          <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input type="checkbox" checked={pass} onChange={(e) => setPass(e.target.checked)} />
            <span>Rondje pass</span>
          </label>

          <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input type="checkbox" checked={pass2} onChange={(e) => setPass2(e.target.checked)} />
            <span>Rondje pass (x2)</span>
          </label>

          <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input type="checkbox" checked={fullRound} onChange={(e) => setFullRound(e.target.checked)} />
            <span>Volledige ronde</span>
          </label>
        </div>

        {/* Spelers + preview */}
        <div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Spelers - kies winnaar(s)</div>

          {players.map((p) => {
            const pts = preview[p.id] ?? 0;
            const selected = winnerIds.includes(p.id);

            return (
              <label
                key={p.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "24px 1fr 80px",
                  gap: 10,
                  alignItems: "center",
                  marginBottom: 6,
                  padding: "6px 8px",
                  borderRadius: 10,
                  border: "1px solid #eee",
                  background: selected ? "#eef6ff" : "transparent",
                }}
              >
                <input type="checkbox" checked={selected} onChange={() => toggleWinner(p.id)} />
                <span>{p.name}</span>
                <span
                  style={{
                    textAlign: "right",
                    fontWeight: 700,
                    color: inputError ? "#999" : pts > 0 ? "green" : pts < 0 ? "crimson" : "#444",
                  }}
                >
                  {inputError ? "—" : pts}
                </span>
              </label>
            );
          })}
        </div>

        {/* Opslaan ronde */}
        <button
          onClick={saveRound}
          disabled={!!inputError}
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid #ccc",
            background: inputError ? "#eee" : "#fafafa",
            color: inputError ? "#777" : "#111",
            fontWeight: 800,
            cursor: inputError ? "not-allowed" : "pointer",
          }}
        >
          Ronde opslaan
        </button>
      </div>

      {/* PUNTENTELLING */}
      <div style={{ fontWeight: 600, marginTop: 24, marginBottom: 6 }}>Puntentelling</div>

      {rounds.length === 0 ? (
        <p>Nog geen rondes.</p>
      ) : (
        <>
          <div
            style={{
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
              border: "1px solid #eee",
              borderRadius: 12,
              marginTop: 8,
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: 520,
                tableLayout: "fixed",
              }}
            >
              <colgroup>
                <col style={{ width: 80 }} />
                {players.map((p, i) => (
                  <col
                    key={p.id}
                    style={{
                      width: SCORE_COL_WIDTH + (i === players.length - 1 ? GAP_AFTER_LAST_PLAYER : 0),
                    }}
                  />
                ))}
                <col style={{ width: CHOICE_COL_WIDTH }} />
              </colgroup>

              <thead>
                <tr>
                  <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #ddd" }}>Ronde</th>

                  {players.map((p, i) => (
                    <th
                      key={p.id}
                      style={{
                        textAlign: "center",
                        padding: 10,
                        borderBottom: "1px solid #ddd",
                        whiteSpace: "nowrap",
                        borderRight: i === players.length - 1 ? "2px solid #ddd" : undefined,
                        paddingRight: i === players.length - 1 ? GAP_AFTER_LAST_PLAYER : 10,
                      }}
                    >
                      {p.name}
                    </th>
                  ))}

                  <th
                    style={{
                      textAlign: "left",
                      padding: 10,
                      paddingLeft: 18,
                      borderBottom: "1px solid #ddd",
                      borderLeft: "2px solid #ddd",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Keuze
                  </th>
                </tr>
              </thead>

              <tbody>
                {rounds.map((r) => (
                  <tr key={r.id}>
                    <td style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #f0f0f0" }}>{r.no}</td>

                    {players.map((p, i) => {
                      const it = r.items.find((x) => x.name === p.name);
                      const val = it?.points ?? 0;

                      return (
                        <td
                          key={p.id}
                          style={{
                            textAlign: "center",
                            padding: 10,
                            borderBottom: "1px solid #f0f0f0",
                            whiteSpace: "nowrap",
                            borderRight: i === players.length - 1 ? "2px solid #eee" : undefined,
                            paddingRight: i === players.length - 1 ? GAP_AFTER_LAST_PLAYER : 10,
                            fontWeight: "normal",
                          }}
                        >
                          {val}
                        </td>
                      );
                    })}

                    {/* ✅ Keuze + vuilbakje rechts (delete ronde) */}
                    <td
                      style={{
                        textAlign: "left",
                        padding: 10,
                        paddingLeft: 18,
                        borderBottom: "1px solid #f0f0f0",
                        borderLeft: "2px solid #eee",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <span>{r.choice ? labelChoice(r.choice) : "—"}</span>

                        <button
                          type="button"
                          onClick={() => deleteRound(r.id)}
                          title="Ronde verwijderen"
                          style={{
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            fontSize: 18,
                            lineHeight: 1,
                          }}
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {/* TOTAALRIJ */}
                <tr>
                  <td style={{ textAlign: "center", padding: 10, fontWeight: 900, borderTop: "2px solid #ddd" }}>
                    Totaal
                  </td>

                  {players.map((p, i) => {
                    const total = totalForName(p.name);
                    return (
                      <td
                        key={p.id}
                        style={{
                          textAlign: "center",
                          padding: 10,
                          fontWeight: 900,
                          borderTop: "2px solid #ddd",
                          whiteSpace: "nowrap",
                          color: totalColor(total),
                          borderRight: i === players.length - 1 ? "2px solid #ddd" : undefined,
                          paddingRight: i === players.length - 1 ? GAP_AFTER_LAST_PLAYER : 10,
                        }}
                      >
                        {total}
                      </td>
                    );
                  })}

                  <td style={{ padding: 10, borderTop: "2px solid #ddd" }} />
                </tr>
              </tbody>
            </table>
          </div>

          {/* ✅ GRAFIEK (zelfde aanpak: SVG + nul-lijn gestippeld) */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Grafiek (totaal na elke ronde)</div>

            <div
              style={{
                overflowX: "auto",
                WebkitOverflowScrolling: "touch",
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 10,
              }}
            >
              {(() => {
                const labels = chart.labels;
                const playerNames = chart.playerNames;
                const series = chart.series;

                const w = Math.max(820, 120 + labels.length * 80); // swipe op gsm
                const h = CHART_H;

                const padL = 50;
                const padR = 20;
                const padT = 20;
                const padB = 30;

                const minY = chart.minY;
                const maxY = chart.maxY;

                const xCount = Math.max(1, labels.length);
                const xStep = (w - padL - padR) / Math.max(1, xCount - 1);

                const yToPx = (v: number) => {
                  const t = (v - minY) / (maxY - minY);
                  return padT + (1 - clamp(t, 0, 1)) * (h - padT - padB);
                };
                const xToPx = (i: number) => padL + i * xStep;

                const zeroY = yToPx(0);

                return (
                  <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Puntenverloop">
                    <rect x={0} y={0} width={w} height={h} fill="white" />

                    {/* nul-lijn */}
                    <line
                      x1={padL}
                      y1={zeroY}
                      x2={w - padR}
                      y2={zeroY}
                      stroke="#999"
                      strokeWidth={1}
                      strokeDasharray="4 4"
                    />

                    {/* assen */}
                    <line x1={padL} y1={padT} x2={padL} y2={h - padB} stroke="#ddd" strokeWidth={1} />
                    <line x1={padL} y1={h - padB} x2={w - padR} y2={h - padB} stroke="#ddd" strokeWidth={1} />

                    {/* y labels */}
                    <text x={10} y={yToPx(maxY) + 4} fontSize={12} fill="#555">
                      {Math.round(maxY)}
                    </text>
                    <text x={10} y={zeroY + 4} fontSize={12} fill="#555">
                      0
                    </text>
                    <text x={10} y={yToPx(minY) + 4} fontSize={12} fill="#555">
                      {Math.round(minY)}
                    </text>

                    {/* x labels */}
                    {labels.map((lab, i) => (
                      <text key={lab} x={xToPx(i)} y={h - 10} fontSize={12} fill="#555" textAnchor="middle">
                        {lab}
                      </text>
                    ))}

                    {/* lines */}
                    {playerNames.map((name, idx) => {
                      const vals = series[name] ?? [];
                      const xs = vals.map((_, i) => xToPx(i));
                      const ys = vals.map((v) => yToPx(v));
                      const d = buildLinePath(xs, ys);
                      const color = COLORS[idx % COLORS.length];

                      return (
                        <g key={name}>
                          <path d={d} fill="none" stroke={color} strokeWidth={3} />
                          {vals.length ? (
                            <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r={4} fill={color} />
                          ) : null}
                        </g>
                      );
                    })}

                    {/* legend */}
                    <g>
                      {playerNames.map((name, idx) => (
                        <g key={name} transform={`translate(${padL + idx * 170}, ${padT})`}>
                          <rect x={0} y={-10} width={14} height={14} fill={COLORS[idx % COLORS.length]} />
                          <text x={20} y={2} fontSize={12} fill="#111">
                            {name}
                          </text>
                        </g>
                      ))}
                    </g>
                  </svg>
                );
              })()}
            </div>
          </div>
        </>
      )}

      {/* ✅ NOTES (los van rondes) */}
      <div style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Notities</div>

        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          rows={4}
          placeholder="Typ hier losse notities voor deze avond..."
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 10,
            border: "1px solid #ccc",
            fontSize: 16,
            resize: "vertical",
          }}
        />

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          {/* ✅ Als je een note aan het editen bent, toon Aanpassen + Annuleer */}
          {editingNoteId ? (
            <>
              <button
                onClick={updateNote}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid #ccc",
                  background: "#fafafa",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Aanpassen
              </button>

              <button
                onClick={() => {
                  setEditingNoteId(null);
                  setNoteText("");
                }}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid #ccc",
                  background: "white",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Annuleer
              </button>
            </>
          ) : (
            <button
              onClick={saveNote}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid #ccc",
                background: "#fafafa",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Notitie opslaan
            </button>
          )}

          {noteStatus ? <span style={{ color: "#666" }}>{noteStatus}</span> : null}
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {notes.length === 0 ? (
            <p style={{ marginTop: 8 }}>Nog geen notities.</p>
          ) : (
            notes.map((n) => (
              <div
                key={n.id}
                style={{
                  border: "1px solid #eee",
                  borderRadius: 12,
                  padding: 10,
                  background: "#fafafa",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 700 }}>{new Date(n.created_at).toLocaleString()}</div>

                  <div style={{ display: "flex", gap: 8 }}>
                    {/* ✅ Aanpassen naast Verwijder */}
                    <button
                      onClick={() => {
                        setEditingNoteId(n.id);
                        setNoteText(n.body);
                        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
                      }}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 10,
                        border: "1px solid #ccc",
                        background: "white",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Aanpassen
                    </button>

                    <button
                      onClick={() => deleteNote(n.id)}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 10,
                        border: "1px solid #ccc",
                        background: "white",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Verwijder
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{n.body}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  // chart memo uses rounds + players, defined below return to keep JSX unchanged
  function useChartMemo() {
    return null;
  }
}

/* ====== memo moved after component is defined (but used inside via closure) ======
   We keep it here to avoid changing your layout flow too much.
*/
function useChartData(rounds: { no: number; items: { name: string; points: number }[] }[], players: Player[]) {
  return { labels: [], playerNames: [], series: {}, minY: 0, maxY: 0 } as any;
}

// ✅ Inline chart memo (keeps file self-contained without changing your UI structure)
const __noop = null as any;

function SessionPageChartMemo(rounds: any[], players: any[]) {
  return __noop;
}

/* ================= CHART MEMO (simple & local) ================= */
function chartMemoFactory(rounds: any[], players: any[]) {
  const labels = rounds.map((r) => r.no);
  const playerNames = players.map((p) => p.name);

  const series: Record<string, number[]> = {};
  for (const name of playerNames) series[name] = [];

  const running: Record<string, number> = {};
  for (const name of playerNames) running[name] = 0;

  for (const r of rounds) {
    for (const name of playerNames) {
      const val = r.items.find((i: any) => i.name === name)?.points ?? 0;
      running[name] += val;
      series[name].push(running[name]);
    }
  }

  let minY = 0;
  let maxY = 0;
  for (const name of playerNames) {
    for (const v of series[name] ?? []) {
      minY = Math.min(minY, v);
      maxY = Math.max(maxY, v);
    }
  }
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }

  return { labels, playerNames, series, minY, maxY };
}

// Hack-free memo for the chart: we re-export a hook-like helper
function useChartMemo(rounds: any[], players: any[]) {
  return useMemo(() => chartMemoFactory(rounds, players), [rounds, players]);
}