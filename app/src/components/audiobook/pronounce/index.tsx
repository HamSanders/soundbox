/**
 * The pronunciation dictionary: this book's rules and the global dictionary
 * every book shares. Rules apply top to bottom, first match wins; book rules
 * come before global ones. Play a term in its sentence, take suggestions
 * from the text, and import or export PLS (W3C) and TXT. Every change marks
 * the voiced paragraphs it affects stale. Mounted by core's inspector.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DownloadIcon,
  Loader2Icon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { useClipPlayer } from "@/components/audiobook/render/use-clip";
import { voiceApi, type RuleInput } from "@/components/audiobook/render/voice-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage } from "@/lib/api";
import { abk } from "@/lib/audiobook-queries";
import type { PronunciationKind, PronunciationRule } from "@/lib/audiobook-types";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<PronunciationKind, string> = { alias: "Alias", ipa: "IPA", cmu: "CMU" };
const PLACEHOLDER: Record<PronunciationKind, string> = {
  alias: "Read as… (e.g. her-MY-oh-nee)",
  ipa: "IPA, e.g. hɝˈmaɪəni",
  cmu: "CMU, e.g. HH ER0 M AY1 AH0 N IY0",
};

export function PronunciationPanel({ bookId }: { bookId: string }) {
  const [scope, setScope] = useState<"book" | "global">("book");
  const dict = scope === "book" ? bookId : null;
  const qc = useQueryClient();
  const key = ["audiobook-voice", "rules", dict ?? "global"] as const;
  const rules = useQuery({ queryKey: key, queryFn: () => voiceApi.listRules(dict) });
  const player = useClipPlayer();
  const [draft, setDraft] = useState<RuleInput>({ term: "", kind: "alias", replacement: "" });
  const [showSuggest, setShowSuggest] = useState(false);
  const suggestions = useQuery({
    queryKey: ["audiobook-voice", "suggest", bookId],
    queryFn: () => voiceApi.suggestTerms(bookId),
    enabled: showSuggest,
  });
  const file = useRef<HTMLInputElement>(null);

  const changed = (stale: number) => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["audiobook-voice", "suggest", bookId] });
    if (stale > 0) {
      void qc.invalidateQueries({ queryKey: abk.book(bookId) });
      void qc.invalidateQueries({ queryKey: abk.allParagraphs(bookId) });
      toast.message(`${stale} voiced paragraph${stale === 1 ? "" : "s"} marked stale.`);
    }
  };
  const fail = (what: string) => (e: unknown) => toast.error(`${what}: ${errorMessage(e)}`);

  const create = useMutation({
    mutationFn: (r: RuleInput) => voiceApi.createRule(dict, r),
    onSuccess: (r) => {
      setDraft({ term: "", kind: draft.kind, replacement: "" });
      changed(r.stale);
    },
    onError: fail("Could not add the rule"),
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<RuleInput> }) => voiceApi.updateRule(dict, id, patch),
    onSuccess: (r) => changed(r.stale),
    onError: fail("Could not save the rule"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => voiceApi.deleteRule(dict, id),
    onSuccess: (r) => changed(r.stale),
    onError: fail("Could not delete the rule"),
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => voiceApi.reorderRules(dict, ids),
    onSuccess: () => changed(0),
    onError: fail("Could not reorder"),
  });
  const importer = useMutation({
    mutationFn: (f: File) => voiceApi.importRules(dict, f),
    onSuccess: (r) => {
      changed(r.stale);
      toast.success(`Imported ${r.added} new and ${r.updated} updated rule${r.added + r.updated === 1 ? "" : "s"}.`, {
        description: r.warnings.slice(0, 3).join(" ") || undefined,
      });
    },
    onError: fail("Import failed"),
  });

  const list = rules.data ?? [];
  const move = (i: number, by: -1 | 1) => {
    const ids = list.map((r) => r.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate(ids);
  };
  const play = (k: string, opts: { rule_id?: string; draft?: RuleInput }) =>
    player.playJob(
      k,
      voiceApi.playTerm(bookId, opts).then((r) => {
        for (const w of r.warnings ?? []) toast.message(w);
        return r;
      }),
    );
  const playIcon = (k: string) =>
    player.active === k ? player.loading ? <Loader2Icon className="animate-spin" /> : <PauseIcon /> : <PlayIcon />;

  return (
    <div className="space-y-3 p-3">
      <Tabs value={scope} onValueChange={(v) => setScope(v as "book" | "global")}>
        <TabsList className="w-full">
          <TabsTrigger value="book">This book</TabsTrigger>
          <TabsTrigger value="global">All books</TabsTrigger>
        </TabsList>
      </Tabs>
      <p className="text-muted-foreground text-xs">
        Applied top to bottom; the first rule that matches a word wins. Book rules come before the shared ones. IPA
        and CMU rules fall back to a plain respelling on models that only read text.
      </p>

      <ul className="space-y-1.5" aria-label="Pronunciation rules">
        {list.map((r, i) => (
          <RuleRow
            key={r.id}
            rule={r}
            first={i === 0}
            last={i === list.length - 1}
            onMove={(by) => move(i, by)}
            onSave={(patch) => update.mutate({ id: r.id, patch })}
            onDelete={() => remove.mutate(r.id)}
            onPlay={() => play(r.id, { rule_id: r.id })}
            playIcon={playIcon(r.id)}
          />
        ))}
        {list.length === 0 && !rules.isLoading ? (
          <li className="text-muted-foreground text-xs">No rules yet.</li>
        ) : null}
      </ul>

      <form
        className="border-border/70 space-y-1.5 rounded-lg border border-dashed p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.term.trim() && draft.replacement.trim()) create.mutate(draft);
        }}
      >
        <div className="flex gap-1.5">
          <Input className="h-7 flex-1 text-xs" placeholder="Term" aria-label="Term" value={draft.term} onChange={(e) => setDraft({ ...draft, term: e.target.value })} />
          <KindSelect value={draft.kind ?? "alias"} onChange={(kind) => setDraft({ ...draft, kind })} />
        </div>
        <div className="flex gap-1.5">
          <Input className="h-7 flex-1 text-xs" placeholder={PLACEHOLDER[draft.kind ?? "alias"]} aria-label="Replacement" value={draft.replacement} onChange={(e) => setDraft({ ...draft, replacement: e.target.value })} />
          {scope === "book" ? (
            <Button size="icon-xs" variant="ghost" type="button" aria-label="Play the draft rule in context" disabled={!draft.term.trim() || !draft.replacement.trim()} onClick={() => play("draft", { draft })}>
              {playIcon("draft")}
            </Button>
          ) : null}
          <Button size="xs" type="submit" disabled={!draft.term.trim() || !draft.replacement.trim() || create.isPending}>
            <PlusIcon />
            Add
          </Button>
        </div>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {scope === "book" ? (
          <Button size="xs" variant="outline" onClick={() => setShowSuggest((s) => !s)} aria-expanded={showSuggest}>
            <SparklesIcon />
            Suggest terms
          </Button>
        ) : null}
        <Button size="xs" variant="outline" onClick={() => file.current?.click()} disabled={importer.isPending}>
          <UploadIcon />
          Import .pls/.txt
        </Button>
        <input
          ref={file}
          type="file"
          accept=".pls,.xml,.txt,text/plain,application/pls+xml"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importer.mutate(f);
            e.target.value = "";
          }}
        />
        <Button size="xs" variant="ghost" asChild>
          <a href={voiceApi.exportUrl(dict, "pls")} download="pronunciations.pls">
            <DownloadIcon />
            PLS
          </a>
        </Button>
        <Button size="xs" variant="ghost" asChild>
          <a href={voiceApi.exportUrl(dict, "txt")} download="pronunciations.txt">
            <DownloadIcon />
            TXT
          </a>
        </Button>
      </div>

      {showSuggest && scope === "book" ? (
        <section className="space-y-1.5" aria-label="Suggested terms">
          <h4 className="text-xs font-medium">Names and invented words in this book</h4>
          {suggestions.isLoading ? <Loader2Icon className="text-muted-foreground size-4 animate-spin" /> : null}
          {suggestions.data?.length === 0 ? <p className="text-muted-foreground text-xs">Nothing new to suggest.</p> : null}
          <ul className="space-y-1">
            {suggestions.data?.slice(0, 30).map((s) => (
              <li key={s.term} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate" title={s.example}>
                  <span className="font-medium">{s.term}</span>
                  <span className="text-muted-foreground"> ×{s.count} · {s.reason === "invented" ? "unusual spelling" : "name"}</span>
                </span>
                <Button size="xs" variant="ghost" onClick={() => setDraft({ term: s.term, kind: "alias", replacement: "" })}>
                  Add rule
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function KindSelect({ value, onChange }: { value: PronunciationKind; onChange: (k: PronunciationKind) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as PronunciationKind)}>
      <SelectTrigger size="sm" className="h-7 w-20 text-xs" aria-label="Rule type">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(KIND_LABEL) as PronunciationKind[]).map((k) => (
          <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RuleRow(props: {
  rule: PronunciationRule;
  first: boolean;
  last: boolean;
  onMove: (by: -1 | 1) => void;
  onSave: (patch: Partial<RuleInput>) => void;
  onDelete: () => void;
  onPlay: () => void;
  playIcon: React.ReactNode;
}) {
  const r = props.rule;
  const toggle = (on: boolean, label: string, field: "case_sensitive" | "whole_word") => (
    <button
      type="button"
      aria-pressed={on}
      title={field === "case_sensitive" ? "Match case" : "Whole word only"}
      className={cn(
        "rounded border px-1 font-mono text-[10px] leading-4",
        on ? "border-primary/60 text-foreground" : "border-border text-muted-foreground",
      )}
      onClick={() => props.onSave({ [field]: !on })}
    >
      {label}
    </button>
  );
  return (
    <li className="border-border/70 space-y-1 rounded-lg border p-1.5">
      <div className="flex items-center gap-1">
        <Input
          className="h-7 flex-1 text-xs font-medium"
          aria-label="Term"
          defaultValue={r.term}
          onBlur={(e) => e.target.value.trim() && e.target.value !== r.term && props.onSave({ term: e.target.value })}
        />
        <KindSelect value={r.kind} onChange={(kind) => props.onSave({ kind })} />
        <Button size="icon-xs" variant="ghost" aria-label={`Play ${r.term} in context`} title="Play in context" onClick={props.onPlay}>
          {props.playIcon}
        </Button>
      </div>
      <div className="flex items-center gap-1">
        <Input
          className="h-7 flex-1 text-xs"
          aria-label={`${r.term} replacement`}
          defaultValue={r.replacement}
          placeholder={PLACEHOLDER[r.kind]}
          onBlur={(e) => e.target.value.trim() && e.target.value !== r.replacement && props.onSave({ replacement: e.target.value })}
        />
        {toggle(r.case_sensitive, "Aa", "case_sensitive")}
        {toggle(r.whole_word, "W", "whole_word")}
        <Button size="icon-xs" variant="ghost" aria-label="Move up" disabled={props.first} onClick={() => props.onMove(-1)}>
          <ArrowUpIcon />
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="Move down" disabled={props.last} onClick={() => props.onMove(1)}>
          <ArrowDownIcon />
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label={`Delete rule for ${r.term}`} onClick={props.onDelete}>
          <Trash2Icon />
        </Button>
      </div>
    </li>
  );
}
