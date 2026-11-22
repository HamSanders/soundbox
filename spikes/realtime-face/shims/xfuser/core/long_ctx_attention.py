class xFuserLongContextAttention:
    def __init__(self, *_a, **_k):
        raise RuntimeError("xfuser shim: multi-GPU attention is not available in this spike")
