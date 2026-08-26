// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AsyncBoundary from "../components/AsyncBoundary";
import { LanguageProvider } from "../i18n/LanguageContext";
import { useAsyncAction, useAsyncResource } from "../lib/useAsyncResource";
import { coded } from "../lib/backendErrors";

/** A promise whose settlement this test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
}

function ResourceHarness({ load }: { load: () => Promise<string> }) {
  const resource = useAsyncResource(load, []);
  return (
    <AsyncBoundary loading={resource.loading} error={resource.error} onRetry={resource.reload}>
      <p data-testid="value">{resource.data}</p>
    </AsyncBoundary>
  );
}

function renderWithLanguage(node: React.ReactNode) {
  return render(<LanguageProvider>{node}</LanguageProvider>);
}

describe("useAsyncResource", () => {
  it("shows a placeholder while loading and the data once it arrives", async () => {
    const gate = deferred<string>();
    renderWithLanguage(<ResourceHarness load={() => gate.promise} />);

    expect(screen.queryByTestId("value")).toBeNull();
    await act(async () => {
      gate.resolve("twelve base oils");
    });
    expect(screen.getByTestId("value").textContent).toBe("twelve base oils");
  });

  it("shows the failure with its translated summary and its untouched detail", async () => {
    const load = vi.fn(() =>
      Promise.reject(new Error(coded("record.notFound", "Base oil not found: bo-7")))
    );
    renderWithLanguage(<ResourceHarness load={load} />);

    // The sentence a user reads comes from the code; the detail names the record and is shown
    // exactly as the backend sent it, beside the sentence rather than instead of it.
    expect(await screen.findByText("This could not be loaded")).toBeTruthy();
    expect(screen.getByText("Base oil not found: bo-7")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("offers a retry that runs the loader again", async () => {
    let attempt = 0;
    const load = vi.fn(() => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error("network")) : Promise.resolve("second try");
    });
    renderWithLanguage(<ResourceHarness load={load} />);

    const retry = await screen.findByRole("button", { name: "Try again" });
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("second try"));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale response that resolves after a newer one", async () => {
    // Typing in a search box produces exactly this: two loads in flight, and the older one
    // finishing last. Without the guard it overwrites the newer result.
    const first = deferred<string>();
    const second = deferred<string>();
    let call = 0;
    const load = () => {
      call += 1;
      return call === 1 ? first.promise : second.promise;
    };

    function Harness() {
      const resource = useAsyncResource(load, []);
      return (
        <>
          <button type="button" onClick={resource.reload}>
            reload
          </button>
          <p data-testid="value">{resource.data ?? ""}</p>
        </>
      );
    }
    renderWithLanguage(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "reload" }));
    await act(async () => {
      second.resolve("newer");
    });
    expect(screen.getByTestId("value").textContent).toBe("newer");

    await act(async () => {
      first.resolve("older");
    });
    expect(screen.getByTestId("value").textContent).toBe("newer");
  });

  it("does not write to an unmounted component", async () => {
    const gate = deferred<string>();
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);

    const { unmount } = renderWithLanguage(<ResourceHarness load={() => gate.promise} />);
    unmount();
    await act(async () => {
      gate.resolve("too late");
    });

    console.error = original;
    // React warns about a state update on an unmounted component; there must be no such warning.
    expect(errors.flat().join(" ")).not.toMatch(/unmounted/i);
  });
});

describe("useAsyncAction", () => {
  it("reports a failure instead of leaving an unhandled rejection", async () => {
    const failure = new Error(coded("record.notFound", "gone"));
    const onError = vi.fn();

    function Harness() {
      const action = useAsyncAction(() => Promise.reject(failure), { onError });
      return (
        <button type="button" onClick={() => void action.run()}>
          {action.running ? "saving" : "save"}
        </button>
      );
    }
    renderWithLanguage(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "save" }));

    // The rejection is delivered to the caller rather than escaping as an unhandled rejection,
    // which is invisible to the user and only shows up as a Vitest exit code.
    await waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
  });

  it("refreshes only after a write that succeeded", async () => {
    const onDone = vi.fn();
    let shouldFail = true;

    function Harness() {
      const action = useAsyncAction(
        () => (shouldFail ? Promise.reject(new Error("no")) : Promise.resolve("yes")),
        { onDone }
      );
      return (
        <button type="button" onClick={() => void action.run()}>
          save
        </button>
      );
    }
    renderWithLanguage(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onDone).not.toHaveBeenCalled());

    shouldFail = false;
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
});
