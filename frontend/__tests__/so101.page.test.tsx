import { act, render } from "@testing-library/react";
import { SO101Client } from "../app/so101/SO101Client";

const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: mockReplace,
    prefetch: jest.fn()
  })
}));

describe("SO101 page environment guard", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockReplace.mockClear();
    delete window.robotcloudDesktop;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders nothing and redirects away in a browser", async () => {
    const { container } = render(<SO101Client />);

    expect(container).toBeEmptyDOMElement();
    expect(mockReplace).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(container).toBeEmptyDOMElement();
    expect(mockReplace).toHaveBeenCalledWith("/");
  });
});
