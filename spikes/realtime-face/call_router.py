"""Which browser socket gets the face's frames and audio.

The spike sent every chunk to every connected socket. Two tabs, a reload that
left the old socket half-open, or a second caller all heard the same audio
(doubled sound) and saw the same face (cross-talk). One face server drives one
face on one GPU, so it serves one call at a time:

- a socket belongs to a call (the `call` claim of its token);
- the first call to connect becomes the active call; frames go to its socket only;
- a second socket for the same call replaces the first (one listener per call);
- a socket for another call is refused as busy while the active call has a socket;
- when the active call's socket goes, the server is free again.

Pure Python, no event loop, so it can be tested on its own (test_call_router.py).
"""


class Busy(Exception):
    pass


class CallRouter:
    def __init__(self):
        self.active = None      # call id the face is currently serving
        self.sockets = {}       # call id -> socket (at most one per call)

    def attach(self, call, ws):
        """Make `ws` the call's socket. Returns (replaced_socket_or_None, switched_call: bool). Raises Busy."""
        if self.active is not None and self.active != call and self.sockets.get(self.active) is not None:
            raise Busy(self.active)
        replaced = self.sockets.get(call)
        switched = self.active != call
        if switched and self.active is not None:
            self.sockets.pop(self.active, None)
        self.active = call
        self.sockets[call] = ws
        return (replaced if replaced is not ws else None), switched

    def detach(self, call, ws):
        """A socket closed. Returns True when that freed the server."""
        if self.sockets.get(call) is not ws:
            return False  # already replaced; the newer socket keeps the call
        del self.sockets[call]
        if self.active == call:
            self.active = None
            return True
        return False

    def end(self, call):
        """Hang up a call from outside (the Call API). Returns its socket, if it had one."""
        ws = self.sockets.pop(call, None)
        if self.active == call:
            self.active = None
        return ws

    def targets(self):
        """The sockets that should receive the next chunk: the active call's, nobody else's."""
        ws = self.sockets.get(self.active) if self.active is not None else None
        return [ws] if ws is not None else []

    @property
    def busy(self):
        return bool(self.targets())
