/** A voice in a picker, with the model it reads on: "Brit · Chatterbox".
 *  A clone saved before voices recorded their model reads on the first ready
 *  one (Voice Lab's rule too), so it says so instead of naming nothing. */
export function VoiceLabel({ name, model }: { name: string; model: string | null }) {
  return (
    <span className="truncate">
      {name}
      <span className="text-muted-foreground ml-1 text-xs">· {model ?? "first ready model"}</span>
    </span>
  );
}
