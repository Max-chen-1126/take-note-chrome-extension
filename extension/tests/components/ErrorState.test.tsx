import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorState } from "../../entrypoints/sidepanel/components/ErrorState";

it("renders as role=alert with title/message and calls onRetry when the retry button is clicked", () => {
  const onRetry = vi.fn();
  render(
    <ErrorState
      title="擷取失敗"
      message="無法讀取字幕，請開啟字幕面板後重試。"
      hint="請重新整理頁面或換一個頁面後再試。"
      onRetry={onRetry}
    />
  );

  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent("擷取失敗");
  expect(alert).toHaveTextContent("無法讀取字幕，請開啟字幕面板後重試。");
  expect(alert).toHaveTextContent("請重新整理頁面或換一個頁面後再試。");

  fireEvent.click(screen.getByRole("button", { name: /重試/ }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it("omits the retry button when onRetry is not provided", () => {
  render(<ErrorState title="錯誤" message="訊息" />);
  expect(screen.queryByRole("button")).toBeNull();
});
