// app/overzicht/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type Player = { id: string; name: string };
type Session = { id: string; date: string; title?: string | null };
type RoundRow = { id: string; session_id: string; choice: string | null };

const CHOICES = [
  { key: "ENKEL", label: "Enkel" },
  { key: "DUBBEL", label: "Dubbel" },
  { key: "TROEL", label: "Troel" },
  { key: "ABONDANCE", label: "Abondance" },
  { key: "KLEINE_MISERE", label: "Kleine misère" },
  { key: "GROTE_MISERE", label: "Grote misère" },
  { key: "SOLO_SLIM", label: "Solo slim" },
] as const;

type ChoiceKey = (typeof CHOICES)[number]["key"];

function totalColor(n: number) {
  return n > 0 ? "green" : n < 0 ? "crimson" : "inherit";
}

/** SVG line chart (geen libs) + 0-lijn (stippel) + hoger */
function LineChart({
  series,
  labels,
}: {
  series: { name: string; values: number[] }[];
  labels: string[];
}) {
  const width = 980;
  const height = 520; // ✅ dubbel zo hoog (was ~260)
  const pad = { l: 56, r: 20, t: 18, b: 56 };

  const all = series.flatMap((s) => s.values);
  const has = all.length > 0;

  const min = has ? Math.min(...all) : 0;
  const max = has ? Math.max(...all) : 0;

  const range = max - min || 1;
  const yMin = min - Math.ceil(range * 0.08);
  const yMax = max + Math.ceil(range * 0.08);

  const n = labels.length;
  const xStep = n > 1 ? (width - pad.l - pad.r) / (n - 1) : 1;

  const x = (i: number) => pad.l + i * xStep;
  const y = (v: number) => {
    const t = (v - yMin) / (yMax - yMin || 1);
    return pad.t + (1 - t) * (height - pad.t - pad.b);
  };

  // grid/axis ticks
  const ticks = 6;
  const yTicks = Array.from({ length: ticks }, (_, i) => yMin + (i * (yMax - yMin)) / (ticks - 1));

  // 0-lijn (stippel) indien binnen bereik
  const zeroInRange = 0 >= yMin && 0 <= yMax;
  const yZero = y(0);

  const palette = ["#2563eb", "#16a34a", "#dc2626", "#7c3aed"]; // blauw, groen, rood, paars

  return (
    <div style={{ overflowX: "auto", marginTop: 12 }}>
      <div style={{ minWidth: width }}>
        <svg width={width} height={height} role="img" aria-label="Puntenverloop per speler">
          {/* Y grid + labels */}
          {yTicks.map((tv, i) => {
            const yy = y(tv);
            return (
              <g key={i}>
                <line x1={pad.l} y1={yy} x2={width - pad.r} y2={yy} stroke="#eee" />
                <text x={pad.l - 10} y={yy + 4} fontSize="11" textAnchor="end" fill="#666">
                  {Math.round(tv)}
                </text>
              </g>
            );
          })}

          {/* 0-lijn */}
          {zeroInRange && (
            <g>
              <line
                x1={pad.l}
                y1={yZero}
                x2={width - pad.r}
                y2={yZero}
                stroke="#999"
                strokeWidth={1.5}
                strokeDasharray="6 6" // ✅ stippellijn
              />
              <text x={width - pad.r} y={yZero - 6} fontSize="11" textAnchor="end" fill="#666">
                0
              </text>
            </g>
          )}

          {/* X axis line */}
          <line x1={pad.l} y1={height - pad.b} x2={width - pad.r} y2={height - pad.b} stroke="#ddd" />

          {/* Series lines */}
          {series.map((s, si) => {
            const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
            return (
              <g key={s.name}>
                <polyline fill="none" stroke={palette[si % palette.length]} strokeWidth={2.5} points={pts} />
                {s.values.map((v, i) => (
                  <circle key={i} cx={x(i)} cy={y(v)} r={3.2} fill={palette[si % palette.length]} />
                ))}
              </g>
            );
          })}

          {/* X labels (sparse if many) */}
          {labels.map((lab, i) => {
            const show = n <= 10 || i === 0 || i === n - 1 || i % 2 === 0;
            if (!show) return null;
            return (
              <text key={lab + i} x={x(i)} y={height - pad.b + 22} fontSize="11" textAnchor="middle" fill="#666">
                {lab}
              </text>
            );
          })}
        </svg>

        {/* legend */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8, fontSize: 12 }}>
          {series.map((s, i) => (
            <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  width: 14,
                  height: 3,
                  background: palette[i % palette.length],
                  display: "inline-block",
                  borderRadius: 999,
                }}
              />
              <span>{s.name}</span>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 14,
                height: 3,
                display: "inline-block",
                borderRadius: 999,
                borderTop: "2px dashed #999",
              }}
            />
            <span>nul-lijn</span>
          </div>
        </div>

        <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
          Dit is het <b>cumulatieve totaal</b> per speler na elk kaartmoment (chronologisch).
        </div>
      </div>
    </div>
  );
}

export default function OverzichtPage() {
  const router = useRouter();

  const [players, setPlayers] = useState<Player[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [status, setStatus] = useState<string>("");

  const [sessionTotals, setSessionTotals] = useState<Record<string, Record<string, number>>>({});
  const [sessionChoiceCounts, setSessionChoiceCounts] = useState<Record<string, Record<ChoiceKey, number>>>(
    {}
  );
  const [sessionRoundCounts, setSessionRoundCounts] = useState<Record<string, number>>({});

  const GAP_AFTER_LAST_PLAYER = 56;
  const SCORE_COL_WIDTH = 96;
  const CHOICE_COL_WIDTH = 112;
  const ROUNDS_COL_WIDTH = 90;

  // ✅ titelstijl zoals vroeger "Kaartmomenten"
  const titleStyle = useMemo(
    () => ({
      marginTop: 14,
      fontWeight: 700,
      fontSize: 18,
      textDecoration: "underline",
    }),
    []
  );

  useEffect(() => {
    (async () => {
      const joinCode = localStorage.getItem("kw_join_code")?.trim();
      if (!joinCode) {
        router.push("/join");
        return;
      }

      setStatus("");

      const { data: group, error: gErr } = await supabase
        .from("groups")
        .select("id")
        .eq("join_code", joinCode)
        .single();

      if (gErr || !group?.id) {
        setStatus("Code ongeldig. Ga naar /join en probeer opnieuw.");
        return;
      }

      const { data: pl, error: plErr } = await supabase
        .from("players")
        .select("id,name")
        .eq("group_id", group.id)
        .order("name");

      if (plErr) {
        setStatus("Fout players: " + plErr.message);
        return;
      }

      const P = pl ?? [];
      setPlayers(P);

      const { data: se, error: seErr } = await supabase
        .from("sessions")
        .select("id,date,title")
        .eq("group_id", group.id)
        .order("date", { ascending: false });

      if (seErr) {
        setStatus("Fout kaartmomenten: " + seErr.message);
        return;
      }

      const S = se ?? [];
      setSessions(S);

      if (S.length === 0) return;

      const sessionIds = S.map((s) => s.id);

      const { data: rd, error: rdErr } = await supabase
        .from("rounds")
        .select("id,session_id,choice")
        .in("session_id", sessionIds);

      if (rdErr) {
        setStatus("Fout rondes: " + rdErr.message);
        return;
      }

      const rounds = (rd ?? []) as RoundRow[];
      const roundIds = rounds.map((r) => r.id);

      // round counts
      const roundCountInit: Record<string, number> = {};
      for (const s of S) roundCountInit[s.id] = 0;
      for (const r of rounds) roundCountInit[r.session_id] = (roundCountInit[r.session_id] ?? 0) + 1;
      setSessionRoundCounts(roundCountInit);

      // scores
      const { data: sc, error: scErr } = await supabase
        .from("scores")
        .select("round_id,player_id,points")
        .in("round_id", roundIds.length ? roundIds : ["00000000-0000-0000-0000-000000000000"]);

      if (scErr) {
        setStatus("Fout scores: " + scErr.message);
        return;
      }

      const totalsInit: Record<string, Record<string, number>> = {};
      for (const s of S) {
        totalsInit[s.id] = {};
        for (const p of P) totalsInit[s.id][p.id] = 0;
      }

      const roundToSession: Record<string, string> = {};
      for (const r of rounds) roundToSession[r.id] = r.session_id;

      for (const row of sc ?? []) {
        const sid = roundToSession[row.round_id];
        if (!sid) continue;
        totalsInit[sid][row.player_id] = (totalsInit[sid][row.player_id] ?? 0) + (row.points ?? 0);
      }
      setSessionTotals(totalsInit);

      // choice counts (all columns always)
      const countsInit: Record<string, Record<ChoiceKey, number>> = {};
      for (const s of S) {
        countsInit[s.id] = {} as Record<ChoiceKey, number>;
        for (const c of CHOICES) countsInit[s.id][c.key] = 0;
      }

      for (const r of rounds) {
        const sid = r.session_id;
        const key = (r.choice ?? "").toUpperCase() as ChoiceKey;
        if (!countsInit[sid]) continue;
        if (countsInit[sid][key] === undefined) continue;
        countsInit[sid][key] += 1;
      }
      setSessionChoiceCounts(countsInit);
    })();
  }, [router]);

  const overallTotals = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of players) out[p.id] = 0;

    for (const s of sessions) {
      const m = sessionTotals[s.id];
      if (!m) continue;
      for (const p of players) out[p.id] += m[p.id] ?? 0;
    }
    return out;
  }, [players, sessions, sessionTotals]);

  const overallRoundCount = useMemo(() => {
    return sessions.reduce((sum, s) => sum + (sessionRoundCounts[s.id] ?? 0), 0);
  }, [sessions, sessionRoundCounts]);

  const overallChoiceCounts = useMemo(() => {
    const out: Record<ChoiceKey, number> = {} as any;
    for (const c of CHOICES) out[c.key] = 0;

    for (const s of sessions) {
      const m = sessionChoiceCounts[s.id];
      if (!m) continue;
      for (const c of CHOICES) out[c.key] += m[c.key] ?? 0;
    }
    return out;
  }, [sessions, sessionChoiceCounts]);

  // grafiek data (cumulatief, chronologisch)
  const chartData = useMemo(() => {
    const sessionsAsc = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
    const labels = sessionsAsc.map((s) => s.date);

    const running: Record<string, number> = {};
    for (const p of players) running[p.id] = 0;

    const series = players.map((p) => ({ name: p.name, values: [] as number[] }));

    for (const s of sessionsAsc) {
      const totals = sessionTotals[s.id] ?? {};
      for (const p of players) running[p.id] += totals[p.id] ?? 0;
      for (const p of players) series.find((x) => x.name === p.name)!.values.push(running[p.id]);
    }

    return { labels, series };
  }, [players, sessions, sessionTotals]);

  return (
    <div style={{ padding: 24, maxWidth: 1200, fontFamily: "system-ui" }}>
      <button onClick={() => router.push("/")}>← Terug</button>

      <h1 style={{ fontWeight: 800, fontSize: 28, margin: "10px 0 6px" }}>Statistieken</h1>
      {status ? <p style={{ color: "crimson" }}>{status}</p> : null}

      {/* ✅ "Kaartmomenten" verwijderd, titel wordt Scores per kaartmoment */}
      <div style={titleStyle}>Scores per kaartmoment</div>

      {sessions.length === 0 ? (
        <p style={{ marginTop: 8 }}>Nog geen kaartmomenten.</p>
      ) : (
        <>
          {/* ================= TABLE 1: SCORES ================= */}
          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: 760,
                tableLayout: "fixed",
              }}
            >
              <colgroup>
                <col style={{ width: 130 }} />
                {players.map((p, i) => (
                  <col
                    key={p.id}
                    style={{
                      width: SCORE_COL_WIDTH + (i === players.length - 1 ? GAP_AFTER_LAST_PLAYER : 0),
                    }}
                  />
                ))}
                <col style={{ width: ROUNDS_COL_WIDTH }} />
              </colgroup>

              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #ddd" }}>
                    Kaartmoment
                  </th>

                  {players.map((p, i) => (
                    <th
                      key={p.id}
                      style={{
                        textAlign: "center",
                        padding: 10,
                        borderBottom: "1px solid #ddd",
                        borderRight: i === players.length - 1 ? "2px solid #ddd" : undefined,
                        paddingRight: i === players.length - 1 ? GAP_AFTER_LAST_PLAYER : 10,
                      }}
                    >
                      {p.name}
                    </th>
                  ))}

                  <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #ddd" }}>
                    Rondes
                  </th>
                </tr>
              </thead>

              <tbody>
                {sessions.map((s) => {
                  const totals = sessionTotals[s.id] ?? {};
                  const roundsCount = sessionRoundCounts[s.id] ?? 0;

                  return (
                    <tr key={s.id}>
                      <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                        <a href={`/session/${s.id}`}>{s.date}</a>
                      </td>

                      {players.map((p, i) => {
                        const val = totals[p.id] ?? 0;
                        return (
                          <td
                            key={p.id}
                            style={{
                              textAlign: "center",
                              padding: 10,
                              borderBottom: "1px solid #f0f0f0",
                              fontWeight: "normal",
                              borderRight: i === players.length - 1 ? "2px solid #eee" : undefined,
                              paddingRight: i === players.length - 1 ? GAP_AFTER_LAST_PLAYER : 10,
                            }}
                          >
                            {val}
                          </td>
                        );
                      })}

                      <td style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                        {roundsCount}
                      </td>
                    </tr>
                  );
                })}

                {/* TOTAAL (bold) */}
                <tr>
                  <td style={{ padding: 10, borderTop: "2px solid #ddd", fontWeight: 900 }}>Totaal</td>

                  {players.map((p, i) => {
                    const val = overallTotals[p.id] ?? 0;
                    return (
                      <td
                        key={p.id}
                        style={{
                          textAlign: "center",
                          padding: 10,
                          borderTop: "2px solid #ddd",
                          fontWeight: 900,
                          color: totalColor(val),
                          borderRight: i === players.length - 1 ? "2px solid #ddd" : undefined,
                          paddingRight: i === players.length - 1 ? GAP_AFTER_LAST_PLAYER : 10,
                        }}
                      >
                        {val}
                      </td>
                    );
                  })}

                  <td style={{ textAlign: "center", padding: 10, borderTop: "2px solid #ddd", fontWeight: 900 }}>
                    {overallRoundCount}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ✅ grafiek onder de score-tabel */}
          {chartData.labels.length >= 2 ? (
            <>
              <div style={{ marginTop: 16, fontWeight: 700 }}>Puntenverloop (cumulatief)</div>
              <LineChart series={chartData.series} labels={chartData.labels} />
            </>
          ) : (
            <div style={{ marginTop: 14, fontSize: 12, color: "#666" }}>
              Voeg minstens 2 kaartmomenten toe om een grafiek te zien.
            </div>
          )}

          {/* ================= TABLE 2: CHOICES ================= */}
          <div style={titleStyle}>Keuzes per kaartmoment</div>

          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: 980,
                tableLayout: "fixed",
              }}
            >
              <colgroup>
                <col style={{ width: 130 }} />
                {CHOICES.map((c) => (
                  <col key={c.key} style={{ width: CHOICE_COL_WIDTH }} />
                ))}
              </colgroup>

              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #ddd" }}>
                    Kaartmoment
                  </th>

                  {CHOICES.map((c) => (
                    <th
                      key={c.key}
                      style={{
                        textAlign: "center",
                        padding: 10,
                        borderBottom: "1px solid #ddd",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {sessions.map((s) => {
                  const counts = sessionChoiceCounts[s.id] ?? ({} as Record<ChoiceKey, number>);

                  return (
                    <tr key={s.id}>
                      <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                        <a href={`/session/${s.id}`}>{s.date}</a>
                      </td>

                      {CHOICES.map((c) => (
                        <td
                          key={c.key}
                          style={{
                            textAlign: "center",
                            padding: 10,
                            borderBottom: "1px solid #f0f0f0",
                            fontWeight: "normal",
                          }}
                        >
                          {counts[c.key] ?? 0}
                        </td>
                      ))}
                    </tr>
                  );
                })}

                {/* TOTAAL (bold) */}
                <tr>
                  <td style={{ padding: 10, borderTop: "2px solid #ddd", fontWeight: 900 }}>Totaal</td>

                  {CHOICES.map((c) => (
                    <td
                      key={c.key}
                      style={{
                        textAlign: "center",
                        padding: 10,
                        borderTop: "2px solid #ddd",
                        fontWeight: 900,
                      }}
                    >
                      {overallChoiceCounts[c.key] ?? 0}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
            Tip: klik op een kaartmoment (datum) om de rondes te bekijken.
          </div>
        </>
      )}
    </div>
  );
}