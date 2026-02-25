// app/page.tsx  (of app/home/page.tsx)
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type Session = { id: string; date: string; title?: string | null };

export default function Home() {
  const router = useRouter();

  const [groupId, setGroupId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [status, setStatus] = useState<string>("");

  // ✅ NEW: gekozen datum
  const [newDate, setNewDate] = useState(
    new Date().toISOString().slice(0, 10)
  );

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

  async function exportCSV() {
    try {
      const blob = new Blob(["Export via dashboard"], {
        type: "text/plain;charset=utf-8;",
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "kleurenwiezen-export.txt";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Export mislukt.");
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

      {/* Fout */}
      {status && <p style={{ color: "crimson" }}>{status}</p>}

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

        <button onClick={exportCSV} style={btnStyle} disabled={!groupId}>
          Export CSV
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
        <button
          onClick={newSession}
          style={grayBtn}
          disabled={!groupId}
        >
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