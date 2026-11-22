# Live avatar creator: ComfyUI serverless worker for RunPod (sketch, not built or pushed).
# Base and helper commands from https://github.com/runpod-workers/worker-comfyui (docs/customization.md).
# Pin the tag you test; 5.1.0 is the example tag in those docs, check the releases page for the current one.
FROM runpod/worker-comfyui:5.1.0-base

# No custom nodes: every node in the three graphs is core ComfyUI (WanFirstLastFrameToVideo,
# TextEncodeQwenImageEditPlus, CreateVideo/SaveVideo, ...). Keep it that way; it is what makes the image small to maintain.

# Option A (bake weights, fastest cold start, ~50 GB image). Option B: put the same files on a
# network volume at /runpod-volume/models/<folder>/ and delete these lines (slower first load, no rebuild per model change).
ARG HF=https://huggingface.co
# Z-Image Turbo, Apache-2.0 (portraits from text)
RUN comfy model download --url $HF/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors --relative-path models/diffusion_models --filename z_image_turbo_bf16.safetensors \
 && comfy model download --url $HF/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors --relative-path models/text_encoders --filename qwen_3_4b.safetensors \
 && comfy model download --url $HF/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors --relative-path models/vae --filename ae.safetensors
# Qwen-Image-Edit 2509 + Lightning 4-step, Apache-2.0 (pose stills)
RUN comfy model download --url $HF/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors --relative-path models/diffusion_models --filename qwen_image_edit_2509_fp8_e4m3fn.safetensors \
 && comfy model download --url $HF/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors --relative-path models/loras --filename Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors \
 && comfy model download --url $HF/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors --relative-path models/text_encoders --filename qwen_2.5_vl_7b_fp8_scaled.safetensors \
 && comfy model download --url $HF/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors --relative-path models/vae --filename qwen_image_vae.safetensors
# Wan 2.2 I2V-A14B fp8 + lightx2v 4-step LoRAs, Apache-2.0 (clips)
RUN for f in diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled \
             loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise \
             text_encoders/umt5_xxl_fp8_e4m3fn_scaled vae/wan_2.1_vae; do \
      comfy model download --url $HF/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/$f.safetensors \
        --relative-path models/$(dirname $f) --filename $(basename $f).safetensors; done

# Our handler replaces the stock one: it takes a character spec, walks portrait -> stills -> clips
# against the local ComfyUI and uploads the pack. See handler.py.
COPY graphs.py build_avatar.py handler.py /avatar/
CMD ["python", "-u", "/avatar/handler.py"]
