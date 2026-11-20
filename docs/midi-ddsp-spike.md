# Spike: MIDI-DDSP as a notes-in model family

**Question.** Could [MIDI-DDSP](https://github.com/magenta/midi-ddsp)
([paper](https://arxiv.org/abs/2112.09312)) become a model family in Mirli that
takes notes in and renders expressive instrument audio locally? Today no model
in the catalogue takes notes. The Studio renders them with a synth and then
applies a timbre with an ACE-Step cover pass (`docs/STUDIO.md`, "The
instrument is a second pass").

**Recommendation: no-go for shipping MIDI-DDSP.** It works: it installed and
rendered on this machine, its pitch was accurate, and its expression controls
did what they claim. But three of its constraints conflict with Mirli's rules:

1. **Licence.** The released weights are trained on URMP, and URMP publishes no
   licence. Under the catalogue rule (`AGENTS.md`: unknown licence → `no`),
   the model would be listed as non-commercial.
2. **Runtime.** It needs Python 3.8, TensorFlow 2.7 and pins from 2022. Mirli
   has "no Python in the inference path" (`docs/ARCHITECTURE.md`,
   `docs/AUDIOCPP.md`). On Windows it runs on CPU only, and slower than real
   time.
3. **Range.** It is monophonic, covers 13 orchestral instruments, outputs
   16 kHz, and the code is archived.

**Next step, if a notes-in model is still wanted:** spike
[TokenSynth](https://github.com/KyungsuKim42/tokensynth) instead (see
[Alternatives](#5-alternatives)). It is MIT-licensed, its weights and training
data are commercially clean, it is polyphonic per instrument and takes any
timbre. It is not real time, and it would still need a sidecar or a port.

Everything below was checked on 2026-11-19. The measurements were taken on an
AMD Ryzen 9 9900X and an RTX 5080, Windows 11.

## 1. Licences

| Part | What it is | Licence | Source |
| --- | --- | --- | --- |
| Code | `magenta/midi-ddsp`, v0.2.6 | **Apache-2.0** | [LICENSE](https://github.com/magenta/midi-ddsp/blob/main/LICENSE); [setup.py](https://github.com/magenta/midi-ddsp/blob/main/setup.py) `license='Apache 2.0'` |
| Code dependency | `ddsp==3.2.0` | Apache-2.0 | [magenta/ddsp](https://github.com/magenta/ddsp) |
| Weights | `midi_ddsp_model_weights_urmp_9_10.zip` (48.4 MB) on the repo's `models` branch | **Not stated.** The branch contains only the zip ([branch listing](https://github.com/magenta/midi-ddsp/tree/models)). The zip contains six checkpoint and log files and no licence. The repo's Apache-2.0 may be meant to cover it, but nothing says so. | [download_model_weights.py](https://github.com/magenta/midi-ddsp/blob/main/midi_ddsp/download_model_weights.py) |
| Training data | URMP: 44 pieces, 13 instruments, 12.5 GB | **Not stated.** The project page and its documentation PDF ask you to cite the paper and fill in a Google form. Neither states a licence, a commercial-use term or a redistribution term. | [URMP page](https://labsites.rochester.edu/air/projects/URMP.html), [URMP_doc.pdf](https://labsites.rochester.edu/air/projects/URMP/URMP_doc.pdf) |
| Paper | arXiv 2112.09312 | CC BY 4.0 (the paper only) | [arXiv](https://arxiv.org/abs/2112.09312) |

**How the catalogue would flag it.** Each entry in
`server/src/models/audiocpp_models_catalog.json` has `license.commercial`
(`yes`, `conditional` or `no`) and a `note`. The README says "Any model whose
licence could not be established is treated as non-commercial". `AGENTS.md`
says to record `no` when a licence is unknown and never to use `conditional` as
a placeholder. ACE-Step's entry already makes the point that training data "is
the question that actually bites". So MIDI-DDSP would be:

```json
"license": {
  "name": "Apache-2.0 (code); weights and URMP training data unlicensed",
  "commercial": "no",
  "url": "https://github.com/magenta/midi-ddsp/blob/main/LICENSE",
  "note": "The code is Apache-2.0. The weights carry no licence of their own, and URMP, the data they were trained on, publishes no licence terms. Treated as non-commercial until the URMP authors say otherwise."
}
```

Contacting the URMP maintainer could change this. The PDF gives a contact
address "for updated information". This spike did not contact them.

## 2. Instruments and controls

**Instruments: 13.** Violin, viola, cello, double bass, flute, oboe, clarinet,
saxophone, bassoon, trumpet, horn, trombone and tuba
([README](https://github.com/magenta/midi-ddsp#try-to-play-with-midi-ddsp-yourself)).
`instrument_name_utils.py` also lists `guitar` (MIDI program 27), but the
synthesizer leaves it out ("excluding guitar",
[midi_ddsp_synthesize.py](https://github.com/magenta/midi-ddsp/blob/main/midi_ddsp/midi_ddsp_synthesize.py)).
A MIDI track maps to an instrument by its General MIDI program. A track with
any other program is either skipped or rendered by FluidSynth
(`--use_fluidsynth`).

**Monophonic.** The paper says the model "is currently limited to training on
recordings of single monophonic instruments"
([arXiv HTML](https://arxiv.org/html/2112.09312)). Ensembles such as the Bach
quartets on the [demo page](https://midi-ddsp.github.io/) are built from one
render per part, mixed with per-part gains.

**Three levels of control**
([paper abstract](https://arxiv.org/abs/2112.09312)):

1. **Notes:** pitch, onset, offset.
2. **Note expression:** six values per note, each in [0, 1] (paper §3.2;
   README "Advance Usage"):
   - `volume`: average amplitude over the note.
   - `vol_fluc`: amplitude standard deviation over the note.
   - `vol_peak_pos`: where the loudest point falls. 0 is a decrescendo, 1 a
     crescendo.
   - `vibrato`: the DFT peak of f0 within the note.
   - `brightness`: the average harmonic centroid.
   - `attack`: noise magnitude over the first 40 ms.

   The Expression Generator predicts all six from the notes. You can then
   override any of them per note and re-render.
3. **Synthesis parameters:** at 250 frames per second
   ([Magenta blog](https://magenta.tensorflow.org/midi-ddsp)), the f0 curve,
   amplitude, a 60-harmonic distribution and 65 noise bands, "127 total
   synthesis parameters each time frame" (paper §3). These can be edited
   directly, for example for pitch bends, and resynthesized through DDSP plus
   a learned per-instrument reverb.

There is no explicit articulation switch (legato, staccato, pizzicato). The
demo's "staccato" violin is made by editing the notes and expression values.
There are no velocity layers: MIDI velocity is not one of the inputs.

This is close to what ACE Studio's instruments expose (per-note dynamics,
vibrato and attack), but limited to 13 student-played URMP timbres. The demo
page notes the URMP players "are students" and that the model has "intonation
accuracy problems".

## 3. Runtime: measured

**Requirements as published.** The README says "python3.8" and "developed
using tensorflow 2.7.0". `setup.py` pins `ddsp==3.2.0`, `crepe<0.0.13`,
`note-seq<0.0.4` and `tensorflowjs<3.19`. The ddsp 3.2.0 metadata pins
`numba<0.50`, which only installs on old Pythons
([PyPI](https://pypi.org/pypi/ddsp/3.2.0/json)). The last release, 0.2.6, was
on 2022-11-30, and the repo is archived
([GitHub API](https://api.github.com/repos/magenta/midi-ddsp)). TensorFlow's
own table lists `tensorflow_gpu-2.7.0` as Python 3.7–3.9 with CUDA 11.2 and
cuDNN 8.1 ([TF Windows build configs](https://www.tensorflow.org/install/source_windows)).
It also says "TensorFlow 2.10 was the last TensorFlow release that supported
GPU on native-Windows" ([TF pip install](https://www.tensorflow.org/install/pip)).

**Install, as performed.** This was done in a uv venv in the session
scratchpad, outside the repo:

```bash
uv venv --python 3.8 venv
uv pip install --python venv/Scripts/python.exe midi-ddsp==0.2.6 tensorflow==2.7.4 \
  tensorflow-probability==0.15.0 tensorflow-addons==0.15.0 keras==2.7.0 "protobuf<3.20"
# Two more pins were needed before it would import:
uv pip install --python venv/Scripts/python.exe numpy==1.21.6        # 1.24 removed np.long
uv pip install --python venv/Scripts/python.exe tensorflow-datasets==4.4.0  # 4.9 needs array_record
venv/Scripts/midi_ddsp_download_model_weights.exe
```

- The resolve and install took 2 m 29 s, plus 25 s to fetch the weights.
- The venv is **2.1 GB**. The weights are **52 MB** on disk: the Synthesis
  Generator is 50.1 MB and the Expression Generator 2.2 MB.
- Unpinned, `pip install midi-ddsp` resolves numpy and tensorflow-datasets
  versions that crash on import. Those two pins are the fix.

**Render.** The test phrase was a 15-note C-major scale up and down, sixteenth
notes at 120 bpm, ending on a held note: 5.0 s of MIDI. Each of four
instruments rendered it through `synthesize_mono_midi`. This ran on CPU only:
TF 2.7 on Windows found no GPU, because no CUDA 11.2 or cuDNN 8.1 is installed.
GPU was not attempted.

| Stage | Time |
| --- | --- |
| `import tensorflow` + midi_ddsp | 14.6 s |
| Load both checkpoints | 3.4 s |
| Violin render (5.92 s audio) | 8.5 s, then 7.9 s warm (RTF 1.34–1.44) |
| Flute (+12 semitones) | 9.2 s (RTF 1.55) |
| Trumpet | 11.1 s (RTF 1.88) |
| Cello (−12 semitones) | 10.5 s (RTF 1.77) |
| Re-render with edited expression (`conditioning_df_to_audio`) | 9.3–10.3 s |

RTF is render time divided by audio length. Every render was slower than real
time.

**Output:** 16 kHz mono. Each render is 0.92 s longer than the MIDI, which is
release and reverb tail.

**Checks on the audio.** The output was measured with `librosa.pyin`, not
listened to:

- **Pitch.** The median pitch of every note was within 0.3 semitone of the
  MIDI note, for all four instruments. The worst case was the cello's first
  note, 47.7 against 48. Voiced frames made up 81–88% of each render.
- **Vibrato control works.** On the same violin phrase, setting `vibrato` to
  0.0 on every note gave a held-note pitch deviation of 3.3 cents (standard
  deviation). Setting it to 1.0 gave 17.0 cents. The model's own prediction
  gave 8.9 cents.

The renders and the script are in the spike session's scratchpad and are not
committed.

## 4. How it would plug into Mirli

**The model runner.** Every model runs as a `ModelSpec` through the audio.cpp
child process ("Every model runs through the audio.cpp binary", `AGENTS.md`).
The other native runtimes are the llama-server and sd-server binaries
(`server/src/models/llamaServerBinary.ts`, `sdServerBinary.ts`). None of them
is Python. `docs/INSTALL.md` says the base install has "no torch, and no GPU
Python wheel". The `task` enum has `gen`, `tts`, `vc` and `sep`
(`docs/ARCHITECTURE.md`), so a notes-in model would also need a new task (say
`synth`) that takes a note list or a `.mid` instead of a prompt.

**The Studio MIDI path.** This model would replace the second pass, not add to
it:

```
today:     notes ──▶ [sawtooth synth] ──▶ dry clip ──▶ [ACE-Step cover] ──▶ timbre
MIDI-DDSP: notes ──▶ [Expression Gen] ──▶ [Synthesis Gen + DDSP] ──▶ performed take
```

- **Strengths.** The notes stay exact, the take keeps its own length (no
  5.12 s minimum like the cover pass), and the per-note expression values could
  be shown and edited in the piano roll.
- **Limits.** It is one instrument per lane and monophonic. The Studio's
  chords and the keyboard presets would need splitting into voices or a
  fallback.
- **Dependency on sibling work.** Expression editing depends on clips keeping
  their notes, which the sibling notes-on-clips work adds.

**Porting to audio.cpp or ONNX: possible in principle, but not tried.**

- **The neural part is small.** It is a bidirectional plus autoregressive GRU
  (Expression Generator), an autoregressive f0 RNN, and a convolutional GAN
  generator (Synthesis Generator), about 52 MB in all (paper §3).
- **The DSP stage needs reimplementing.** It is DDSP's harmonic oscillator
  bank, filtered noise and a reverb impulse per instrument. Those are plain
  DSP, easier to write natively than to export. DDSP itself ships a TFLite and
  TF.js exporter for its timbre-transfer models
  ([ddsp_export.py](https://github.com/magenta/ddsp/blob/main/ddsp/training/ddsp_export.py)).
  That exporter does not cover MIDI-DDSP's two generators.
- **The port would be new upstream work.** It would mean a new model family in
  audio.cpp, which Mirli consumes but does not develop.
- **The licence result stays the same either way.** A port would still ship
  URMP-trained weights marked `commercial: "no"`, which is weeks of work for a
  non-commercial model.

The only route without a port is a Python sidecar: a frozen 2.1 GB TF-2.7
environment on Python 3.8, CPU-only on Windows. That is the opposite of how
Mirli installs models today.

## 5. Alternatives

These are open models that take notes in and render instrument audio, released
or updated since 2022. Licences come from each repo's licence via the GitHub
API and from model cards, read on 2026-11-19.

| Model | Notes in | Code | Weights | Training data | Range | Runtime | State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **[TokenSynth](https://github.com/KyungsuKim42/tokensynth)** ([paper](https://arxiv.org/abs/2502.08939)) | MIDI plus a CLAP timbre embedding (reference audio or text) | MIT | MIT ([HF card](https://huggingface.co/KyungsuKim/TokenSynth)) | NSynth ([CC BY 4.0](https://magenta.tensorflow.org/datasets/nsynth)) and Lakh MIDI ([CC BY 4.0](https://colinraffel.com/projects/lmd/)) | Polyphonic, single instrument; any timbre | PyTorch `>=2.0,<2.6`, Python ≥3.10 ([PyPI](https://pypi.org/pypi/tokensynth/json)); 175M-parameter transformer to DAC 44 kHz tokens | Active (pushed 2026-06-24) |
| [Music Spectrogram Diffusion](https://github.com/magenta/music-spectrogram-diffusion) ([paper](https://arxiv.org/abs/2206.05408)) | MIDI, multi-instrument | Apache-2.0 | Apache-2.0 ([HF](https://huggingface.co/google/music-spectrogram-diffusion)) | Includes MAESTRO, which is [CC BY-NC-SA](https://magenta.tensorflow.org/datasets/maestro) | Polyphonic, multi-instrument, 16 kHz | JAX/T5X; diffusers pipeline is now deprecated | Archived |
| [DDSP-Piano](https://github.com/lrenault/ddsp-piano) | MIDI | Apache-2.0 | in repo | MAESTRO (CC BY-NC-SA) | Polyphonic piano | TensorFlow / ddsp | Last push 2024-05-24 |
| [ddsp-guitar-infer](https://github.com/openmirlab/ddsp-guitar-infer) | MIDI, per string | Apache-2.0 | Its README says "no party in its provenance chain grants an explicit license for the trained weights" | — | Guitar | PyTorch, about 360 MB checkpoint | Active |
| [MIDI-VALLE](https://github.com/nii-yamagishilab/MIDI-VALLE) ([paper](https://arxiv.org/abs/2507.08530)) | MIDI plus a reference recording and its MIDI | Apache-2.0 | README badge says CC BY-NC-SA 4.0, but the Zenodo LICENSE says CC BY 4.0 ([Zenodo](https://zenodo.org/records/15976272)) | ATEPP; audio withheld for copyright | Piano | PyTorch 2.1 + k2 | 2025 |

Ruled out because they take audio, not notes, or are non-commercial:

- [DDSP-VST](https://github.com/magenta/ddsp-vst) is audio in.
- [RAVE](https://github.com/acids-ircam/RAVE) is audio in, and its code is
  CC BY-NC 4.0.
- [NEWT](https://github.com/ben-hayes/neural-waveshaping-synthesis) takes
  pitch and loudness curves, not notes.
- MusicGen-melody takes a melody recording, and its weights are CC BY-NC 4.0
  ([HF](https://huggingface.co/facebook/musicgen-melody)).
- Stable Audio Open takes text or audio, not notes.
- Deep Performer and Music ControlNet published no weights.

**TokenSynth is the only candidate that passes the licence bar.**

- **Licences.** The code and weights are MIT. Its frozen components are DAC
  (MIT, [descript-audio-codec](https://github.com/descriptinc/descript-audio-codec))
  and LAION CLAP (CC0-1.0, [LAION-AI/CLAP](https://github.com/LAION-AI/CLAP)).
  Both datasets are CC BY 4.0. The Lakh page adds a caveat: its MIDI files were
  "scraped from publicly-available sources", so that CC BY 4.0 rests on the
  dataset author's grant. A catalogue note should say so.
- **Not real time.** The paper says it "cannot perform real-time synthesis",
  because it needs the whole MIDI sequence first, and it publishes no speed
  figures.
- **It may drift from the notes.** The paper says it "may not strictly follow
  the input MIDI notes", which is the same weakness the cover pass has.
- **Coarse velocity.** It has only four velocity levels, a limit it inherits
  from NSynth.
- **Weights.** One checkpoint is 713 MB, plus 2.35 GB for CLAP and 307 MB for
  DAC ([HF tree](https://huggingface.co/api/models/KyungsuKim/TokenSynth/tree/main)).
- **Unverified.** Its `torch<2.6` pin may not have builds for the RTX 5080.
  This was not run.

A TokenSynth spike should measure three things: speed on the 5080, how
faithfully it follows the notes compared with the cover pass, and whether it
could be exported to ONNX or brought into audio.cpp.

## Summary

| Requirement | MIDI-DDSP |
| --- | --- |
| Notes in | Yes, monophonic |
| Commercial-safe | **No**: URMP has no licence, so the catalogue rule gives `no` |
| Local, no Python | **No**: Python 3.8 + TF 2.7 sidecar; a port is possible but unbuilt |
| GPU on Windows | **No**: TF 2.7 needs CUDA 11.2; not attempted |
| Speed | CPU RTF 1.3–1.9, slower than real time |
| Expressive controls | **Yes**: six per-note controls, verified for vibrato |
| Maintained | **No**: archived, last release 2022-11-30 |

No-go for MIDI-DDSP. If a notes-in model is still wanted after the sampled
SFZ dry render lands, the next spike should be TokenSynth.
