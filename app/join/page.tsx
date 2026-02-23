"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState("");

  function save() {
    localStorage.setItem("kw_join_code", code.trim());
    router.push("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-muted/40">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader>
          <CardTitle>Groep code</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code">Code</Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="bv. camelot-2026-...."
            />
          </div>
          <Button className="w-full" onClick={save} disabled={!code.trim()}>
            Opslaan
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
