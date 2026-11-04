---
name: Model request
about: Propose a new open-weight audio model for Konchi
title: "[Model] "
labels: model
---

**Model**
Name, and a link to the Hugging Face repo or official GitHub.

**Licence**
The licence on the **weights**, which often differs from the code licence. Does it
permit commercial use? Is the repo gated on Hugging Face?

A model whose licence can't be determined is still welcome, but it goes in as
non-commercial until someone reads the terms, and non-commercial models are
labelled as such in the UI.

**Specs**
Parameter count, sample rate, channels, max duration, approximate VRAM.

**audio.cpp support**
Konchi runs every model through [audio.cpp](https://github.com/0xShug0/audio.cpp).
Is there an audio.cpp loader family and a GGUF conversion for it? Link them if
so. This is the part that becomes the catalog entry.

**Why it's worth adding**
What does it do better than the models already supported? Benchmarks welcome,
but "it sounds noticeably better for impacts" is useful too.
