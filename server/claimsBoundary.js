import { interpretPlayerInputV2 } from "@open-historia/agent-runtime";

const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

/**
 * Normal-play boundary. Player/model text can describe intentions, but this
 * function returns preview data only and has no command or mutation callback.
 */
export function previewClaimsBoundary({ worldState, actorPolityId, rawText, modelOutput }) {
  const interpretation = interpretPlayerInputV2(worldState, {
    actorPolityId,
    playerText: rawText,
    modelOutput,
  });
  const groundedIntents = interpretation.value.requestedActions.filter((entry) => entry.status === "grounded");
  const fallbackIntent = groundedIntents[0]?.intent ?? null;
  const contradictions = interpretation.value.claims
    .filter((claim) => claim.grounding === "contradicted")
    .map((claim) => ({
      claimId: claim.claimId,
      message: fallbackIntent === null
        ? "That premise is not in the record."
        : `That premise is not in the record; the valid intention can still be attempted as “${fallbackIntent}”.`,
    }))
    .sort((left, right) => compare(left.claimId, right.claimId));

  return {
    revision: interpretation.revision,
    asOfMonth: interpretation.asOfMonth,
    actorPolityId: interpretation.value.actorPolityId,
    questions: interpretation.value.questions,
    claims: interpretation.value.claims,
    requestedActions: interpretation.value.requestedActions,
    proposedInitiatives: interpretation.value.proposedInitiatives,
    contradictions,
    evidenceIds: interpretation.evidenceIds,
  };
}

/**
 * Create a separate editor-route boundary around a server-owned authentication
 * verifier. Capabilities are opaque object identities recorded in a closure;
 * no serializable auth flags, player fields or cloned objects can forge one.
 */
export function createAuthenticatedEditorBoundary({ verifyAuthenticatedContext } = {}) {
  if (typeof verifyAuthenticatedContext !== "function") {
    throw new Error("server authentication verifier required");
  }
  const issuedCapabilities = new WeakMap();
  return Object.freeze({
    issueCapability(authenticatedContext) {
      const verified = verifyAuthenticatedContext(authenticatedContext);
      if (
        verified === null
        || typeof verified !== "object"
        || verified.authorized !== true
        || typeof verified.principalId !== "string"
      ) {
        throw new Error("authenticated world:edit server context required");
      }
      const capability = Object.freeze(Object.create(null));
      issuedCapabilities.set(capability, verified.principalId);
      return capability;
    },
    createEnvelope(capability, intervention) {
      if (capability === null || typeof capability !== "object" || !issuedCapabilities.has(capability)) {
        throw new Error("invalid server editor capability");
      }
      if (intervention === null || typeof intervention !== "object" || Array.isArray(intervention)) {
        throw new Error("editor intervention must be an object");
      }
      return Object.freeze({
        kind: "authenticated-editor-envelope",
        principalId: issuedCapabilities.get(capability),
        intervention: structuredClone(intervention),
      });
    },
  });
}
