"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type Session = { id: string; date: string; title?: string | null };

export default function Home() {
  const router = useRouter();
  const [groupId, setGroupId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [status, setStatus] = useState<string>(""); // enkel fouten tonen

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

  async function newSession() {
    if (!groupId) return;

    const today = new Date().toISOString().slice(0, 10);
    const title = `Avond ${today}`;

    const { data, error } = await supabase
      .from("sessions")
      .insert({ group_id: groupId, date: today, title })
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
      if (!groupId) {
        alert("Geen groupId gevonden.");
        return;
      }

      const { data: sess } = await supabase
        .from("sessions")
        .select("id")
        .eq("group_id", groupId);

      if (!sess || sess.length === 0) {
        alert("Geen data om te exporteren.");
        return;
      }

      const blob = new Blob(["Export via dashboard"], {
        type: "text/plain;charset=utf-8;",
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "kleurenwiezen-export.txt";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("Export mislukt.");
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 900 }}>
      {/* Titel */}
      <h1 style={{ fontWeight: 800, fontSize: 28, marginBottom: 10 }}>
        Dashboard kleurenwiezen
      </h1>

      {/* Foutmelding */}
      {status ? <p style={{ color: "crimson" }}>{status}</p> : null}

      {/* Bovenste knoppen */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <button
          onClick={changeCode}
          style={{
            padding: "6px 10px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: "white",
            fontWeight: 600,
          }}
        >
          Code wijzigen
        </button>

        <button
          onClick={exportCSV}
          style={{
            padding: "6px 10px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: "white",
            fontWeight: 600,
          }}
          disabled={!groupId}
        >
          Export CSV
        </button>
      </div>

      {/* Actieknoppen onder elkaar */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginTop: 6,
          marginBottom: 10,
        }}
      >
        <button
          onClick={newSession}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: "white",
            color: "#111",
            fontWeight: 600,
            width: "fit-content",
          }}
          disabled={!groupId}
        >
          Nieuwe avond
        </button>

        <button
          onClick={() => router.push("/overzicht")}
          style={{
            padding: "8px 14px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: "white",
            fontWeight: 600,
            width: "fit-content",
          }}
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