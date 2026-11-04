/**
 * Story routes.
 *
 * A story is a script that stays: ordered lines that each know where they read
 * in the script and where they sit in time. Sessions already group a run of
 * generations, but a session is a log — you don't rearrange one. A story is a
 * document, so it gets its own resource with its own child collection rather
 * than being expressed as a session with extra fields.
 *
 * Two things here are deliberately jobs rather than plain calls: speaking a
 * line and exporting the mixdown. Both take real time, and routing them
 * through the same queue as every other generation means the client shows
 * progress with the machinery it already has instead of a second convention
 * for "slow request".
 */

import type { FastifyInstance } from "fastify";

import {
  segmentCreateSchema,
  segmentGenerateSchema,
  segmentPatchSchema,
  segmentReorderSchema,
  segmentSplitSchema,
  storyFromSoundSchema,
  storyPatchSchema,
  trackPatchSchema,
  type Story,
} from "../schemas.js";
import type { KonchiService } from "../service.js";
import type { StoryEvent } from "../story-hub.js";
import { HttpError, intQuery, streamSse } from "./helpers.js";

type StoryParams = { Params: { story_id: string } };
type SegmentParams = { Params: { story_id: string; segment_id: string } };
type TrackParams = { Params: { story_id: string; track_index: string } };

function hasKey(body: unknown, key: string): boolean {
  return typeof body === "object" && body !== null && key in body;
}

export function registerStories(app: FastifyInstance, svc: KonchiService): void {
  app.get("/api/stories", async (request) => {
    const query = request.query as Record<string, string | string[] | undefined>;
    // With timelines: this list is the studio's shelf, and every card on it
    // draws the story's arrangement as its thumbnail.
    return svc.listStories(intQuery(query.limit, "limit", 50, 1, 200), true);
  });

  app.post("/api/stories", async (request, reply) => {
    const patch = request.body == null ? null : storyPatchSchema.parse(request.body);
    return reply
      .code(201)
      .send(
        svc.createStory(patch?.title ?? null, patch?.project_id ?? null, patch?.builder ?? "script"),
      );
  });

  app.get<StoryParams>("/api/stories/:story_id", async (request) => {
    const story = svc.getStory(request.params.story_id);
    if (story === null) throw new HttpError(404, "Story not found");
    return story;
  });

  app.patch<StoryParams>("/api/stories/:story_id", async (request) => {
    const patch = storyPatchSchema.parse(request.body ?? {});
    const hasTitle = hasKey(request.body, "title");
    const hasProject = hasKey(request.body, "project_id");
    const hasOptions = hasKey(request.body, "request_options");
    if (!hasTitle && !hasProject && !hasOptions) throw new HttpError(422, "Nothing to update");
    const id = request.params.story_id;
    let story: Story | null = null;
    if (hasTitle) {
      story = svc.renameStory(id, patch.title!); // min_length enforced by the schema
      if (story === null) throw new HttpError(404, "Story not found");
    }
    if (hasProject) {
      // Sent-at-all rather than truthy: null is a real target state (unfile).
      story = svc.setStoryProject(id, patch.project_id ?? null);
      if (story === null) throw new HttpError(404, "Story not found");
    }
    if (hasOptions) {
      // `{}` is a real target state too — it puts every line back on the
      // model's own defaults.
      story = svc.setStoryOptions(id, patch.request_options ?? {});
      if (story === null) throw new HttpError(404, "Story not found");
    }
    return story!;
  });

  /**
   * Delete a story. `?delete_sounds=true` takes its generated audio with it;
   * by default the audio stays in the library, just no longer part of a story.
   * Which is right depends on whether you're throwing away a draft or clearing
   * out a finished piece, so it's the caller's call rather than the schema's.
   */
  app.delete<StoryParams>("/api/stories/:story_id", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const deleteSounds = query.delete_sounds === "true" || query.delete_sounds === "1";
    if (!(await svc.deleteStory(request.params.story_id, deleteSounds))) {
      throw new HttpError(404, "Story not found");
    }
    return reply.code(204).send();
  });


  /**
   * Build a story from an existing library sound. With `separate`, the sound is
   * split into stems first and each lands on its own track — the studio's way
   * of opening something mixed back up into its parts.
   */
  app.post("/api/stories/from-sound", async (request, reply) => {
    const body = storyFromSoundSchema.parse(request.body);
    const job = svc.submitStoryFromSound(body.sound_id, {
      separate: body.separate,
      model: body.model ?? null,
      stems: body.stems ?? null,
    });
    return reply.code(202).send({ job_id: job.id });
  });



  /**
   * Live view of one story: what changed, and whether an agent is mid-work.
   *
   * The studio holds this open while a story is on screen, so a script an
   * agent is writing over MCP appears as it is written rather than on the next
   * refresh. The first frame carries current agent activity, since a client
   * that connects mid-call would otherwise not know until the agent finished.
   */
  app.get<StoryParams>("/api/stories/:story_id/events", async (request, reply) => {
    const storyId = request.params.story_id;
    if (svc.getStory(storyId) === null) throw new HttpError(404, "Story not found");
    const queue = svc.stories.subscribe(storyId);
    await streamSse(request, reply, queue, {
      initial: (): StoryEvent[] => {
        const now = svc.stories.activity(storyId);
        return [
          { type: "agent", active: now.active, label: now.label ?? "", count: now.count },
        ];
      },
      cleanup: () => svc.stories.unsubscribe(storyId, queue),
    });
  });

  /* ---------------------------------------------------------------- tracks */

  app.get<StoryParams>("/api/stories/:story_id/tracks", async (request) => {
    if (svc.getStory(request.params.story_id) === null) {
      throw new HttpError(404, "Story not found");
    }
    return svc.listTracks(request.params.story_id);
  });

  /** Upsert: a track's first setting is also its row's creation, so there is
   *  nothing to POST first. */
  app.patch<TrackParams>("/api/stories/:story_id/tracks/:track_index", async (request) => {
    const patch = trackPatchSchema.parse(request.body ?? {});
    const index = Number(request.params.track_index);
    if (!Number.isInteger(index)) throw new HttpError(422, "track_index must be an integer");
    const track = svc.updateTrack(request.params.story_id, index, patch);
    if (track === null) throw new HttpError(404, "Story not found");
    return track;
  });

  /** Removes the lane and the clips on it — see `Database.deleteTrack` for why
   *  the audio goes too. Lanes above slide down. */
  app.delete<TrackParams>("/api/stories/:story_id/tracks/:track_index", async (request) => {
    const index = Number(request.params.track_index);
    if (!Number.isInteger(index)) throw new HttpError(422, "track_index must be an integer");
    const removed = svc.deleteTrack(request.params.story_id, index);
    if (removed === null) throw new HttpError(404, "Story not found");
    return { removed_clips: removed };
  });

  /* -------------------------------------------------------------- segments */

  app.get<StoryParams>("/api/stories/:story_id/segments", async (request) => {
    if (svc.getStory(request.params.story_id) === null) {
      throw new HttpError(404, "Story not found");
    }
    return svc.listSegments(request.params.story_id);
  });

  app.post<StoryParams>("/api/stories/:story_id/segments", async (request, reply) => {
    if (svc.getStory(request.params.story_id) === null) {
      throw new HttpError(404, "Story not found");
    }
    const body = segmentCreateSchema.parse(request.body ?? {});
    return reply.code(201).send(svc.createSegment(request.params.story_id, body));
  });

  /** Reorder is registered before the `:segment_id` routes so "reorder" is not
   *  swallowed as a segment id. */
  app.put<StoryParams>("/api/stories/:story_id/segments/reorder", async (request) => {
    if (svc.getStory(request.params.story_id) === null) {
      throw new HttpError(404, "Story not found");
    }
    const body = segmentReorderSchema.parse(request.body);
    if (!svc.reorderSegments(request.params.story_id, body.segment_ids)) {
      // The client sent an order for a set of lines that no longer matches the
      // story — usually another tab added or deleted one. Refusing beats
      // applying half of it.
      throw new HttpError(409, "That ordering doesn't match this story's lines any more");
    }
    return svc.listSegments(request.params.story_id);
  });

  app.patch<SegmentParams>("/api/stories/:story_id/segments/:segment_id", async (request) => {
    const patch = segmentPatchSchema.parse(request.body ?? {});
    const segment = svc.updateSegment(request.params.segment_id, patch);
    if (segment === null) throw new HttpError(404, "Line not found");
    return segment;
  });

  app.delete<SegmentParams>(
    "/api/stories/:story_id/segments/:segment_id",
    async (request, reply) => {
      if (!svc.deleteSegment(request.params.segment_id)) {
        throw new HttpError(404, "Line not found");
      }
      return reply.code(204).send();
    },
  );

  app.post<SegmentParams>(
    "/api/stories/:story_id/segments/:segment_id/generate",
    async (request, reply) => {
      const body = segmentGenerateSchema.parse(request.body);
      const job = svc.submitSegmentGenerate(request.params.segment_id, body);
      return reply.code(202).send({ job_id: job.id });
    },
  );

  app.post<SegmentParams>(
    "/api/stories/:story_id/segments/:segment_id/split",
    async (request) => {
      const body = segmentSplitSchema.parse(request.body);
      const halves = svc.splitSegment(request.params.segment_id, body.at_s);
      if (halves === null) throw new HttpError(404, "Line not found");
      return halves;
    },
  );

  app.post<StoryParams>("/api/stories/:story_id/export", async (request, reply) => {
    const job = svc.submitStoryExport(request.params.story_id);
    return reply.code(202).send({ job_id: job.id });
  });
}
