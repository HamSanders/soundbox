/**
 * Make a call voice from one of your preset voices (a model's own voice, e.g. Kokoro's): the preset reads a
 * script you write, you listen, and the clip is saved as a clone voice. The call worker clones every voice
 * from a clip, so this is how a preset gets onto a call. The clip carries the delivery, not just the timbre:
 * write the script the way the character talks.
 *
 * Built only from Mirli's own APIs: speak (a job), then "make a voice from this sound".
 */
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, type Sound } from "@/lib/api";
import { qk, useVoices } from "@/lib/queries";

import { callKeys } from "../queries";

/** The call worker reads the first 12 s of a clip (CALL_VOICE_MAX_S on the server); aim a little under. */
const MAX_S = 12;
/** Speech runs at about 2.5 words a second. */
const secondsFor = (text: string) => text.trim().split(/\s+/).filter(Boolean).length / 2.5;

const DEFAULT_SCRIPT =
  "Oh, hello there! It's so nice to hear from you. I was just putting the kettle on. So tell me, how has your day been? Anything good happen?";

type Phase = { at: "write" } | { at: "reading"; progress: number } | { at: "listen"; sound: Sound } | { at: "saving"; sound: Sound };

export function MakeCallVoice({ name, onMade }: { name: string; onMade: (voiceId: string) => void }) {
  const [open, setOpen] = useState(false);
  const { data: voices } = useVoices();
  const presets = useMemo(() => (voices ?? []).filter((v) => v.kind === "builtin" && v.model_id), [voices]);
  const [presetId, setPresetId] = useState("");
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [voiceName, setVoiceName] = useState("");
  const [phase, setPhase] = useState<Phase>({ at: "write" });
  const [err, setErr] = useState<string | null>(null);
  const unsub = useRef<(() => void) | null>(null);
  const qc = useQueryClient();

  const preset = presets.find((p) => p.id === presetId) ?? presets[0];
  useEffect(() => () => unsub.current?.(), []);
  /** Opening names the voice after the character, fresh each time. */
  const openDialog = () => {
    setVoiceName(`${name.trim() || preset?.name || "Call"} voice`);
    setOpen(true);
  };

  const secs = secondsFor(script);
  const busy = phase.at === "reading" || phase.at === "saving";

  const read = async () => {
    if (!preset?.model_id || !script.trim()) return;
    setErr(null);
    setPhase({ at: "reading", progress: 0 });
    try {
      const { job_id } = await api.speak({
        model: preset.model_id,
        lines: [{ voice_id: preset.id, text: script.trim() }],
        name: `${voiceName.trim() || "Call voice"} (reference)`,
        tags: ["call-voice"],
      });
      unsub.current?.();
      unsub.current = api.subscribeJob(
        job_id,
        async (job) => {
          if (job.status === "done") {
            const id = job.result?.sounds?.[0];
            if (!id) return fail("The read finished without a sound.");
            try {
              setPhase({ at: "listen", sound: await api.getSound(id) });
            } catch (e) {
              fail(e);
            }
          } else if (job.status === "error" || job.status === "cancelled") {
            fail(job.error ?? "The read didn't finish.");
          } else {
            setPhase({ at: "reading", progress: job.progress ?? 0 });
          }
        },
        (e) => fail(e),
      );
    } catch (e) {
      fail(e);
    }
  };

  const fail = (e: unknown) => {
    setErr(e instanceof Error ? e.message : String(e));
    setPhase({ at: "write" });
  };

  const save = async () => {
    if (phase.at !== "listen") return;
    const sound = phase.sound;
    setPhase({ at: "saving", sound });
    try {
      const v = await api.createVoice({
        name: voiceName.trim() || `${preset?.name ?? "Call"} voice`,
        kind: "clone",
        source_sound_id: sound.id,
        reference_text: script.trim(),
        notes: `Made for calls from the preset voice ${preset?.name ?? ""}.`.trim(),
        tidy: true,
      });
      await Promise.all([qc.invalidateQueries({ queryKey: qk.voices }), qc.invalidateQueries({ queryKey: callKeys.voices })]);
      onMade(v.id);
      close();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase({ at: "listen", sound });
    }
  };

  const close = () => {
    unsub.current?.();
    unsub.current = null;
    setOpen(false);
    setPhase({ at: "write" });
    setErr(null);
  };

  return (
    <>
      <Button variant="outline" size="sm" className="w-fit" onClick={openDialog} data-testid="make-call-voice">
        <Wand2 /> Make a call voice from a preset
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? openDialog() : busy ? null : close())}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Make a call voice</DialogTitle>
            <DialogDescription>
              A preset voice reads your script, and that clip becomes the voice on calls. It copies the delivery too, so write
              it the way {name.trim() || "they"} would talk.
            </DialogDescription>
          </DialogHeader>

          {presets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No preset voices yet. Save one in Voices (Add a voice, then a model's own voice), then come back.
            </p>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label>Preset voice</Label>
                <Select value={preset?.id ?? ""} onValueChange={setPresetId} disabled={busy}>
                  <SelectTrigger data-testid="preset-voice"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {presets.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cv-script">Script</Label>
                <Textarea id="cv-script" rows={5} value={script} disabled={busy}
                  onChange={(e) => { setScript(e.target.value); if (phase.at === "listen") setPhase({ at: "write" }); }} />
                <p className={secs > MAX_S ? "text-xs text-danger" : "text-xs text-muted-foreground"}>
                  About {Math.round(secs)} s. Calls use the first {MAX_S} s, so aim for 8 to {MAX_S}: one or two lines in their own words, with a question.
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cv-name">Save as</Label>
                <Input id="cv-name" value={voiceName} disabled={busy} onChange={(e) => setVoiceName(e.target.value)} />
              </div>
              {phase.at === "listen" || phase.at === "saving" ? (
                <audio controls autoPlay src={phase.sound.file} className="w-full" data-testid="call-voice-preview" />
              ) : null}
              {err ? <p className="text-sm text-danger" role="alert">{err}</p> : null}
            </div>
          )}

          <DialogFooter>
            {phase.at === "listen" || phase.at === "saving" ? (
              <>
                <Button variant="outline" onClick={() => void read()} disabled={busy}><RotateCcw /> Read it again</Button>
                <Button onClick={() => void save()} disabled={busy} data-testid="save-call-voice">
                  {phase.at === "saving" ? <Loader2 className="animate-spin" /> : null} Use this voice
                </Button>
              </>
            ) : (
              <Button onClick={() => void read()} disabled={busy || !preset || !script.trim()} data-testid="read-call-voice">
                {phase.at === "reading" ? <><Loader2 className="animate-spin" /> Reading {Math.round(phase.progress * 100)}%</> : "Read it"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
