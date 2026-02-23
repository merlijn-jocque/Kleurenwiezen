"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function SetupPage() {
  const router = useRouter();
  const [status, setStatus] = useState("Bezig met setup...");

  useEffect(() => {
    (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const user = userRes.user;
      if (!user) return router.push("/login");

      // Heb ik al een membership?
      const { data: membership } = await supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", user.id)
        .limit(1);

      if (membership && membership.length > 0) {
        setStatus("Je bent al gekoppeld aan een groep ✅");
        return router.push("/");
      }

      setStatus("Groep aanmaken...");

      // Maak group (owner = jij)
      const { data: group, error: groupErr } = await supabase
        .from("groups")
        .insert({ name: "Mijn kaartgroep", owner_id: user.id })
        .select("id")
        .single();

      if (groupErr || !group) {
        setStatus("Fout bij groep maken: " + (groupErr?.message ?? "unknown"));
        return;
      }

      setStatus("Jou toevoegen als lid...");

      const { error: memErr } = await supabase
        .from("group_members")
        .insert({ group_id: group.id, user_id: user.id });

      if (memErr) {
        setStatus("Fout bij member toevoegen: " + memErr.message);
        return;
      }

      setStatus("Klaar! ✅");
      router.push("/");
    })();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-muted/40">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader>
          <CardTitle>Setup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p>{status}</p>
          <Button className="w-full" onClick={() => router.push("/")}>
            Naar dashboard
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
