import { render, screen } from "@testing-library/react";
import { Spinner } from "../../../entrypoints/sidepanel/components/ui/Spinner";

it("renders a visually-hidden label alongside the spinning icon", () => {
  render(<Spinner label="載入中" />);
  expect(screen.getByText("載入中")).toBeTruthy();
});
