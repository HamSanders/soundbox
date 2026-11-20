def _unsupported(*_a, **_k):
    raise RuntimeError("xfuser shim: multi-GPU sequence parallelism is not available in this spike")

get_sequence_parallel_rank = _unsupported
get_sequence_parallel_world_size = _unsupported
get_sp_group = _unsupported
init_distributed_environment = _unsupported
initialize_model_parallel = _unsupported
get_world_group = _unsupported
