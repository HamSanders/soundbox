---
title: "I couldn't afford ElevenLabs, so I listened to 28 voice models"
description: Two scripts, one designed voice, 28 models. ElevenLabs lists at about 80× the cheapest; it doesn't sound 80× better. The clips are here to judge.
date: 2026-11-21
author: Anthony Saviano
tags: [voice, tts, research]
draft: true
---

I definitely paid for ElevenLabs, and that's a lot of the reason I started
building Mirli: I just couldn't afford to do that, and I figured there's got to
be better ways. So we put the same two scripts and the same voice through 28
voice models, local and cloud, English and Spanish, and the clips on this page
are what came out. This is about speech for narration, game lines and
voiceover — not music, sound effects, real-time conversation, training your own
voice, or installing Mirli, which is [the install guide](./INSTALL.md).

The claim is narrow. The list-price spread between these models is about 80×,
and the quality spread is nowhere near that. ElevenLabs is good; it isn't 80
times better than the cheapest voice that sounds human, and you can check that
by ear below.

## How we tested

- **Two scripts of about 290 characters.** One English (283), one Spanish
  (280), conversational, with questions, a number and a time in them: "Wait,
  you found it? After three whole years? … Meet me at the station at half past
  seven, and bring the map."
- **Each vendor's own stock voice for presets.** ElevenLabs' Rachel, Google's
  Kore, MiniMax's Wise_Woman, Kokoro's af_heart — their choice of voice, not
  ours.
- **One 7.9-second reference for every clone, and no real person in it.** We
  designed the voice from one sentence of text with Qwen3-TTS VoiceDesign
  (Apache-2.0): "A warm, slightly husky woman in her forties with a calm, low
  voice and a hint of amusement, speaking at a relaxed pace, close to the
  microphone." One model needed more; see MiniMax below.
- **Word error, not likeness.** Every output was transcribed back with
  Qwen3-ASR 0.6B and scored against its script. That tells you whether the
  words survived, not whether they sound good — we had no speaker-verification
  model installed, so likeness is judged by ear.
- **Cloud through fal.ai, local on an RTX 5080.** Cloud models are priced at
  fal's list prices. Local models ran through audio.cpp v0.9.5 at q8_0, on the
  weights Mirli downloads, driven by a script rather than the app.
- **MP3 throughout, shown as video.** The blog embeds video, not audio, so each
  player is one still frame showing the model, attribution and label.

The 28 counts a speech-to-speech mode and MiniMax's clone-preview step as part
of their models: 24 with clips here, and four we tested but can't play you.

Two things nearly went differently. We almost played only the open models,
because the paid ones' terms through a reseller are unclear — and rejected it,
because a comparison that hides the expensive side isn't a comparison. The paid
clips are here as research, rendered through fal, each attributed and labelled.

The first clone run used the default voice that ships with an open model.
Nobody could say whose voice that was, so we threw out every clone and
re-rendered them all from the designed one, MiniMax's $1.50 clone fee paid a
second time. A voice of unknown origin is a cheap reference right up until you
publish it.

The boring result matters most. 50 of the 52 playable clips we scored came back
at 2% word error or under, and 44 came back word for word. Intelligibility is
solved; what's left is how it sounds and what it costs.

## Preset voices: one script, five prices

| Model | List price per 1,000 characters | This clip | Arena Elo | Why it is here |
| --- | --- | --- | --- | --- |
| ElevenLabs Eleven v4 | $0.08 ([fal](https://fal.ai/models/elevenlabs/tts/eleven-v4)) | $0.0226 | 1340 | Joint first on the arena: the one to beat |
| ElevenLabs Eleven v4 Turbo | $0.04 ([fal](https://fal.ai/models/elevenlabs/tts/eleven-v4-turbo)) | $0.0113 | 1340 | The same score as v4 at half the price |
| Google Gemini 3.8 Flash TTS | $0.045 ([fal](https://fal.ai/models/google/gemini-3.8-flash-tts)) | $0.0127 | 1282 | The one that surprised me |
| MiniMax Speech 2.8 HD | $0.10 ([fal](https://fal.ai/models/fal-ai/minimax/speech-2.8-hd)) | $0.0283 | 1173 | Dearer than ElevenLabs, and I still rate it |
| Kokoro 82M | $0.02 ([fal](https://fal.ai/models/fal-ai/kokoro/american-english)); $0.00099 ([DeepInfra](https://deepinfra.com/hexgrad/Kokoro-82M)); $0 on your own GPU | $0.0057 | 1060 | Open weights (Apache-2.0), small enough to run locally |

Prices are the vendors' public list prices, read on 2026-11-20. ElevenLabs'
own API lists v4 at the same $0.08 and v4 Turbo at $0.04
([elevenlabs.io/pricing/api](https://elevenlabs.io/pricing/api), read
2026-11-20). "This clip" is what the 283-character English clip cost at fal's
list price. Elo is from the
[Artificial Analysis speech arena](https://artificialanalysis.ai/text-to-speech/leaderboard),
read 2026-11-20 — blind pairwise votes, recomputed several times a day, so a
snapshot rather than a ranking.

The 80× is ElevenLabs v4 at $0.08 per 1,000 characters against Kokoro on
DeepInfra at $0.00099.

![ElevenLabs Eleven v4 reading the English script in its stock voice, Rachel](/media/voices/preset_elevenv4_en.mp4 "/media/posters/voices/preset_elevenv4_en.jpg")

*ElevenLabs Eleven v4, via fal.ai. AI-generated speech using a stock voice:
Rachel (ElevenLabs stock).* 18.2 s of audio, 8.0 s round trip, 0% word error.

This is good. ElevenLabs was good before I started, and nothing in the run
changed that.

![ElevenLabs Eleven v4 Turbo reading the English script in a stock voice](/media/voices/preset_elevenv4turbo_en.mp4 "/media/posters/voices/preset_elevenv4turbo_en.jpg")

*ElevenLabs Eleven v4 Turbo, via fal.ai. AI-generated speech using a stock
voice: preset.* 18.0 s of audio, 4.7 s round trip, 0% word error.

If you pay ElevenLabs, this is the line to know: on the arena v4 Turbo ties v4
at 1340, at half the list price. Play the two back to back and pick the
expensive one.

![Google Gemini 3.8 Flash TTS reading the English script in its stock voice, Kore](/media/voices/preset_gemini38flash_en.mp4 "/media/posters/voices/preset_gemini38flash_en.jpg")

*Google Gemini 3.8 Flash TTS, via fal.ai. AI-generated speech using a stock
voice: Kore (Google stock).* 17.0 s of audio, 7.9 s round trip, 0% word error.

I was surprised by Google for sure. It sits 58 Elo below ElevenLabs v4, and on
the arena's own price column Google's direct API is $16.49 per million
characters against ElevenLabs' $80 — about a fifth.

![MiniMax Speech 2.8 HD reading the English script in its stock voice, Wise_Woman](/media/voices/preset_minimax28hd_en.mp4 "/media/posters/voices/preset_minimax28hd_en.jpg")

*MiniMax Speech 2.8 HD, via fal.ai. AI-generated speech using a stock voice:
Wise_Woman (MiniMax stock).* 21.2 s of audio, 5.7 s round trip, 0% word error.

MiniMax isn't the cheap option. It's here because of what I'd say about
ElevenLabs: "I don't even think it outperforms the likes of Google or even
MiniMax. Maybe not in these tests as clear, but in just extended usage." The
arenas won't settle that. MiniMax's older 02 HD leads the released models on the
[Hugging Face TTS Arena V2](https://huggingface.co/spaces/TTS-AGI/TTS-Arena-V2)
(read 2026-11-20) and sits between 43rd and 51st on Artificial Analysis. Two
boards that far apart on one model are a reason to trust your ear over either.

![Kokoro 82M reading the English script in its stock voice, af_heart](/media/voices/preset_kokoro_en.mp4 "/media/posters/voices/preset_kokoro_en.jpg")

*Kokoro 82M, via fal.ai (licence: Apache-2.0). AI-generated speech using a
stock voice: af_heart.* 17.0 s of audio, 1.3 s round trip, 1.9% word error
(one word).

Kokoro is the bottom of the price range, and it isn't ElevenLabs: 280 Elo
lower, and on Artificial Analysis' pronunciation test it passes 55.5% against
v4's 91.7%, failing mainly on exact sequences like codes and numbers. Spell
those out as words before Kokoro sees them.

## Cloning from one 8-second clip

This is the reference every clone below was given — a voice nobody owns,
because nobody has it.

![The designed reference voice: a warm, low woman's voice reading one line in English, made from a text description](/media/voices/input_designed-voice-ref_7.9s.mp4 "/media/posters/voices/input_designed-voice-ref_7.9s.jpg")

*Qwen3-TTS 1.7B VoiceDesign via fal.ai (licence: Apache-2.0). AI-generated
speech. The voice was designed from a text prompt; no real person.* 7.9 s.

![MiniMax Speech 2.8 HD cloning the designed voice and reading the English script](/media/voices/clone_minimax28hd_en.mp4 "/media/posters/voices/clone_minimax28hd_en.jpg")

*MiniMax Speech 2.8 HD, via fal.ai. AI-generated speech. The voice is one we
designed from a text prompt; no real person was recorded or cloned.* 20.6 s of
audio, 8.1 s round trip, 0% word error.

MiniMax needs at least 10 seconds, so it got the whole 20.1-second render the
reference was cut from. It charges $1.50 per clone on
[fal](https://fal.ai/models/fal-ai/minimax/voice-clone) plus $0.10 per 1,000
characters, deletes a cloned voice after 7 days unused, and ranks 29th in
English on the
[Artificial Analysis cloned-voice board](https://artificialanalysis.ai/text-to-speech/leaderboard/controlled-voice)
(read 2026-11-20).

![Qwen3-TTS 1.7B cloning the designed voice and reading the English script](/media/voices/clone_qwen3tts17b_en.mp4 "/media/posters/voices/clone_qwen3tts17b_en.jpg")

*Qwen3-TTS 1.7B, via fal.ai (licence: Apache-2.0). AI-generated speech. The
voice is one we designed from a text prompt; no real person was recorded or
cloned.* 19.3 s of audio, 119 s round trip, 0% word error.

Qwen3-TTS has open weights, and its authors report the best English word error
of any open model on Seed-TTS-eval — their number, not an independent one. On
fal it lists at $0.09 per 1,000 characters, more than ElevenLabs v4 Turbo, and
fal scales open weights to zero when nobody is using them, so a first call
waits for a cold GPU. Open weights on someone else's machine are neither cheap
nor quick.

![Fun-CosyVoice3 cloning the designed voice and reading the English script, rendered on a local GPU](/media/voices/clone_selfhost-cosyvoice3_en.mp4 "/media/posters/voices/clone_selfhost-cosyvoice3_en.jpg")

*Fun-CosyVoice3, self-hosted on our GPU (licence: Apache-2.0). AI-generated
speech. The voice is one we designed from a text prompt; no real person was
recorded or cloned.* 24.3 s of audio, rendered in 4.3 s after a 3.6 s load,
1.9% word error (one word), $0.

![VoxCPM2 cloning the designed voice and reading the Spanish script, rendered on a local GPU](/media/voices/clone_selfhost-voxcpm2_es.mp4 "/media/posters/voices/clone_selfhost-voxcpm2_es.jpg")

*VoxCPM2, self-hosted on our GPU (licence: Apache-2.0). AI-generated speech.
The voice is one we designed from a text prompt; no real person was recorded or
cloned.* 17.1 s of audio, rendered in 3.0 s after a 3.2 s load, 0% word error,
$0.

Those two ran on an RTX 5080, a fast card. On a CPU the same clip takes
minutes, and an 8 GB NVIDIA GPU is the realistic floor. "Free" here means your
electricity, not no wait.

The cheapest clone on any price list we read is Chatterbox Turbo on
[DeepInfra](https://deepinfra.com/ResembleAI/chatterbox-turbo), at $1.00 per
million characters ($0.001 per 1,000), read 2026-11-20. Cheapest isn't best:
open Chatterbox is 47th of 52 on the cloned-voice board.

## Where ElevenLabs still wins

- **The top of the preset arena.** v4 and v4 Turbo are joint first on
  Artificial Analysis at 1340, and nothing in the run outscores them there.
- **Cloning outside English.** On the cloned-voice boards ElevenLabs v4 is
  first or second in 8 of the 9 non-English languages, and first in Spanish. It
  isn't in our run because fal has no ElevenLabs clone endpoint. In English
  cloning it's 6th and 7th, behind models from Alibaba, HeyGen and Speechify.
- **Native two-voice dialogue.** Eleven v3's text-to-dialogue, two of its stock
  voices, one request:

![ElevenLabs Eleven v3 text-to-dialogue: two stock voices, Aria and Roger, trading four lines about a noise behind the shed](/media/voices/dialogue_elevenv3_en.mp4 "/media/posters/voices/dialogue_elevenv3_en.jpg")

*ElevenLabs Eleven v3, via fal.ai. AI-generated speech using a stock voice:
ElevenLabs stock voices Aria and Roger.* 14.5 s of audio, 6.8 s round trip, 0%
word error, $0.0202 at $0.10 per 1,000 characters
([fal](https://fal.ai/models/fal-ai/elevenlabs/text-to-dialogue/eleven-v3)).

The alternatives are thin. Gemini's two-speaker mode answered every request
through fal with a 422 on 2026-11-20, a two-line "Hello, how are you today?"
included. VibeVoice 1.5B worked, but took about two and a half minutes and
carries Microsoft's research-only intent. Mirli does dialogue by reading a
script one line per voice ([the studio](./STUDIO.md)), which works with any
model here but can't overlap two speakers or time their turns the way a native
dialogue model does.

## Where the open models fall down

![FireRedTTS3 cloning the designed voice and failing to read the Spanish script, rendered on a local GPU](/media/voices/clone_selfhost-fireredtts3_es.mp4 "/media/posters/voices/clone_selfhost-fireredtts3_es.jpg")

*FireRedTTS3 Base, self-hosted on our GPU (licence: Apache-2.0). AI-generated
speech. The voice is one we designed from a text prompt; no real person was
recorded or cloned.* 19.8 s of audio, 98% word error.

That's FireRedTTS3 reading the Spanish script as unintelligible pseudo-English.
It accepted `language: "Spanish"` — after rejecting `es`, `spanish` and
`Español` — and then ignored it: 100% word error in the first run, 98% in the
re-run, from a model whose authors report the best average on a 24-language
benchmark. Our guess is audio.cpp's port, which is marked experimental, rather
than the model, but we haven't proven it. Either way, don't use it for Spanish
today. A model that takes the language flag and ignores it fails more quietly
than one that refuses.

The other gaps are smaller but real:

- **One more miss above 2%.** Qwen3 VoiceDesign in Spanish came back at 3.9%
  word error.
- **A gap outside English.** Open models trail closed ones by roughly 100 to
  200 Elo on every non-English cloned-voice board.
- **Licences that aren't "anything goes".** The open models played here are
  all Apache-2.0, but some of the best open voice models are
  non-commercial. Mirli shows each model's licence before you download it.
- **None of them verified in the app.** In Mirli these are catalogue extras
  you switch on from the Models page, and none of the open models played here —
  CosyVoice3, VoxCPM2, Kokoro, Qwen3-TTS, FireRedTTS3 — is marked verified end
  to end, even though the clips came from the same runtime and weights.

## The four we can't play you

We ran these, but their terms don't let us publish the output, so they're named
rather than left out.

- **Inworld TTS-1.5 Max.** Two preset voices, one per language, read the
  scripts word for word, at a list price of $0.01 per 1,000 characters on fal,
  and it's 5th on the Hugging Face TTS Arena V2. Inworld's
  [terms](https://inworld.ai/terms) (§3, read 2026-11-20) license output
  "solely for your internal business purposes", and a public post isn't that.
- **HeyGen Voice and HeyGen Voice Turbo.** Both cloned our designed voice in
  English and Spanish, every transcript matching except one word in one Spanish
  demo line. They're 2nd and 4th on the Artificial Analysis cloned-voice board,
  and Turbo lists at $0.004 per 1,000 characters on fal, the cheapest paid
  clone we ran — if you're picking a cloner, you should know they rank that
  high. HeyGen's [Voice Terms](https://www.heygen.com/voice-terms) (§4, read
  2026-11-20): "These Voice Terms do not authorize public listing, resale or
  unrestricted reuse of a custom voice."
- **RVC, a voice changer.** It converted our 20.1-second designed render on our
  GPU in 1.5 s, at 1.9% word error. The
  [weights repo](https://huggingface.co/lj1995/VoiceConversionWebUI) says
  research use only, and the target voice is a bundled checkpoint of unknown
  origin.

## What I'd use, paying out of my own pocket

"There's nothing that makes ElevenLabs worth the money, in my opinion …
certainly not like 10 times the price of others or 20x." As a list, local
first:

- **Presets on your own GPU: Kokoro.** Apache-2.0, it costs electricity, and
  its weak spot — numbers and codes — has a known workaround.
- **Cloning on your own GPU: CosyVoice3 or VoxCPM2.** Both Apache-2.0, both
  cloned our voice in seconds on a fast card, and VoxCPM2's Spanish came back
  word for word.
- **A voice of your own without a voice actor: design it, then clone it.**
  Describe it once to Qwen3-TTS VoiceDesign, keep the clip, and clone from it
  for every line after. That's how the voice in this post was made.
- **Paid presets: Gemini 3.8 Flash before ElevenLabs.** The closest of the rest
  to ElevenLabs on the arena, at about a fifth of the price direct or a little
  over half through fal.
- **If you need ElevenLabs: v4 Turbo, not v4.** Same arena score, half the
  price. Pay for it where it actually leads — native dialogue and cloning
  outside English.

If you don't have a GPU, a hosted option for Mirli is coming.

The 80× buys you about 280 arena points, and a model that passes 91.7% of a
pronunciation test instead of 55.5%. Whether that's worth it is your ear's
call, which is why the clips are here and the adjectives aren't.
