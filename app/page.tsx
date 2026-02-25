// app/page.tsx (of app/home/page.tsx)
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type Session = { id: string; date: string; title?: string | null };
type Player = { id: string; name: string };

// rounds kan overslagen/mult hebben in je DB (je gebruikt die al bij insert)
type RoundRow = {
  id: string;
  session_id: string;
  round_no: number;
  choice: string | null;
  overslagen: number | null;
  mult: number | null;
};

type ScoreRow = {
  round_id: string;
  player_id: string;
  points: number | null;
};

export default function Home() {
  const router = useRouter();

  const [groupId, setGroupId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [status, setStatus] = useState<string>("");

  // ✅ NEW: gekozen datum
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    (async () => {
      const joinCode = localStorage.getItem("kw_join_code")?.trim();
      if (!joinCode) return router.push("/join");

      const { data: group, error: gErr } = await supabase
        .from("groups")
        .select("id")
        .eq("join_code", joinCode)
        .single();

      if (gErr || !group?.id) {
        setStatus("Code ongeldig. Ga naar /join en probeer opnieuw.");
        return;
      }

      setGroupId(group.id);

      const { data: se, error: seErr } = await supabase
        .from("sessions")
        .select("id,date,title")
        .eq("group_id", group.id)
        .order("date", { ascending: false });

      if (seErr) {
        setStatus("Fout sessions: " + seErr.message);
        return;
      }

      setSessions(se ?? []);
      setStatus("");
    })();
  }, [router]);

  /* ================== ACTIES ================== */

  async function newSession() {
    if (!groupId || !newDate) return;

    const title = `Avond ${newDate}`;

    const { data, error } = await supabase
      .from("sessions")
      .insert({
        group_id: groupId,
        date: newDate,
        title,
      })
      .select("id")
      .single();

    if (error) {
      setStatus("Fout bij nieuwe avond: " + error.message);
      return;
    }

    router.push(`/session/${data.id}`);
  }

  function changeCode() {
    localStorage.removeItem("kw_join_code");
    router.push("/join");
  }

  // ✅ Export: 1 rij per sessie, per ronde kolommen (choice/overslagen/mult + punten per speler)
  async function exportTxt() {
    try {
      if (!groupId) {
        alert("Geen groupId gevonden.");
        return;
      }

      setStatus("Export maken...");

      // 1) spelers
      const { data: pl, error: plErr } = await supabase
        .from("players")
        .select("id,name")
        .eq("group_id", groupId)
        .order("name");

      if (plErr) {
        setStatus("Fout players: " + plErr.message);
        return;
      }

      const players: Player[] = (pl ?? []) as Player[];

      // 2) sessies
      const { data: se, error: seErr } = await supabase
        .from("sessions")
        .select("id,date,title")
        .eq("group_id", groupId)
        .order("date", { ascending: false });

      if (seErr) {
        setStatus("Fout sessions: " + seErr.message);
        return;
      }

      const S: Session[] = (se ?? []) as Session[];
      if (S.length === 0) {
        setStatus("Geen sessies om te exporteren.");
        return;
      }

      const sessionIds = S.map((s) => s.id);

      // 3) rondes (met overslagen/mult indien aanwezig)
      const { data: rd, error: rdErr } = await supabase
        .from("rounds")
        .select("id,session_id,round_no,choice,overslagen,mult")
        .in("session_id", sessionIds)
        .order("round_no", { ascending: true });

      if (rdErr) {
        setStatus("Fout rondes: " + rdErr.message);
        return;
      }

      const rounds: RoundRow[] = (rd ?? []) as any;
      const roundIds = rounds.map((r) => r.id);

      // 4) scores
      const { data: sc, error: scErr } = await supabase
        .from("scores")
        .select("round_id,player_id,points")
        .in(
          "round_id",
          roundIds.length ? roundIds : ["00000000-0000-0000-0000-000000000000"]
        );

      if (scErr) {
        setStatus("Fout scores: " + scErr.message);
        return;
      }

      const scores: ScoreRow[] = (sc ?? []) as any;

      // helpers: per ronde -> per player -> points
      const scoreByRound: Record<string, Record<string, number>> = {};
      for (const row of scores) {
        scoreByRound[row.round_id] ??= {};
        scoreByRound[row.round_id][row.player_id] = Number(row.points ?? 0);
      }

      // rondes per sessie (op volgorde)
      const roundsBySession: Record<string, RoundRow[]> = {};
      for (const r of rounds) {
        roundsBySession[r.session_id] ??= [];
        roundsBySession[r.session_id].push(r);
      }
      for (const sid of Object.keys(roundsBySession)) {
        roundsBySession[sid].sort((a, b) => a.round_no - b.round_no);
      }

      const maxRounds = Math.max(...S.map((s) => (roundsBySession[s.id]?.length ?? 0)));

      // 5) header bouwen (TSV)
      const baseCols = ["session_date", "session_title", "round_count"];
      const header: string[] = [...baseCols];

      for (let i = 1; i <= maxRounds; i++) {
        header.push(`r${i}_choice`, `r${i}_overslagen`, `r${i}_mult`);
        for (const p of players) header.push(`r${i}_${p.name}`);
      }

      const lines: string[] = [];
      lines.push(header.join("\t"));

      // 6) rows
      for (const s of S) {
        const rs = roundsBySession[s.id] ?? [];
        const row: string[] = [
          s.date ?? "",
          (s.title ?? "").replace(/\t/g, " "),
          String(rs.length),
        ];

        for (let i = 0; i < maxRounds; i++) {
          const r = rs[i];

          if (!r) {
            // lege rondekolommen
            row.push("", "", "");
            for (const _p of players) row.push("");
            continue;
          }

          row.push(
            (r.choice ?? "").toString(),
            r.overslagen === null || r.overslagen === undefined ? "" : String(r.overslagen),
            r.mult === null || r.mult === undefined ? "" : String(r.mult)
          );

          const m = scoreByRound[r.id] ?? {};
          for (const p of players) {
            const v = m[p.id];
            row.push(v === undefined ? "" : String(v));
          }
        }

        lines.push(row.join("\t"));
      }

      const txt = lines.join("\n");

      // 7) download als .txt
      const blob = new Blob([txt], { type: "text/plain;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;

      const today = new Date().toISOString().slice(0, 10);
      a.download = `kleurenwiezen-sessies-rondes_${today}.txt`;

      a.click();
      URL.revokeObjectURL(url);

      setStatus("");
    } catch (e: any) {
      console.error(e);
      setStatus("");
      alert("Export mislukt: " + (e?.message ?? "onbekend"));
    }
  }

  /* ================== STYLES ================== */

  // Centrale knopstijl
  const btnStyle: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid #ccc",
    background: "white",
    fontWeight: 600,
    width: 220,
    textAlign: "center",
    color: "#111",
    cursor: "pointer",
  };

  const grayBtn: React.CSSProperties = {
    ...btnStyle,
    background: "#f2f2f2",
  };

  /* ================== UI ================== */

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 900 }}>
      {/* Titel */}
      <h1 style={{ fontWeight: 800, fontSize: 28, marginBottom: 10 }}>
        Dashboard kleurenwiezen
      </h1>

      {/* Fout/status */}
      {status && <p style={{ color: status.includes("Fout") ? "crimson" : "#666" }}>{status}</p>}

      {/* Bovenste knoppen */}
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <button onClick={changeCode} style={btnStyle}>
          Code wijzigen
        </button>

        {/* ✅ Export TXT */}
        <button onClick={exportTxt} style={btnStyle} disabled={!groupId}>
          Export TXT
        </button>
      </div>

      {/* Actieknoppen */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginTop: 6,
          marginBottom: 12,
          maxWidth: 220,
        }}
      >
        {/* ✅ Datum selector (gecentreerd + grijs) */}
        <div
          style={{
            ...grayBtn,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: 0,
          }}
        >
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            style={{
              border: "none",
              background: "transparent",
              width: "100%",
              height: "100%",
              padding: "8px 12px",
              fontWeight: 600,
              outline: "none",
              cursor: "pointer",
              display: "flex",
              justifyContent: "center",
              textAlignLast: "center",
              appearance: "none",
              WebkitAppearance: "none",
              MozAppearance: "none",
            }}
          />
        </div>

        {/* ✅ Nieuwe avond (grijs) */}
        <button onClick={newSession} style={grayBtn} disabled={!groupId}>
          Nieuwe avond
        </button>

        {/* Statistieken */}
        <button
          onClick={() => router.push("/overzicht")}
          style={btnStyle}
          disabled={!groupId}
        >
          Statistieken
        </button>
      </div>

      {/* Kaartmomenten */}
      <h2
        style={{
          marginTop: 28,
          marginBottom: 6,
          fontWeight: 700,
          textDecoration: "underline",
        }}
      >
        Kaartmomenten
      </h2>

      {/* Lijst */}
      <ul style={{ marginTop: 12, paddingLeft: 18 }}>
        {sessions.map((s) => (
          <li key={s.id} style={{ marginBottom: 6 }}>
            <a
              href={`/session/${s.id}`}
              style={{
                textDecoration: "none",
                fontWeight: 400,
                color: "#111",
              }}
            >
              {s.date}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}