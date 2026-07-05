import { render, waitFor } from "@testing-library/react";
import HomePage from "../app/page";

const replaceMock = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock
  })
}));

describe("home page", () => {
  beforeEach(() => {
    replaceMock.mockReset();
  });

  it("redirects to the dashboard on the client", async () => {
    render(<HomePage />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/dashboard");
    });
  });
});
