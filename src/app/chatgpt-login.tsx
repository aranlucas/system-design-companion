import { LoginWithChatGPT } from "@opencoredev/loginwithchatgpt-react";

interface ChatgptLoginProps {
  onConnected: () => void;
}

export function ChatgptLogin({ onConnected }: ChatgptLoginProps) {
  return (
    <LoginWithChatGPT
      label="Continue with ChatGPT"
      consent={{ appName: "System Design Companion" }}
      onAuthenticated={onConnected}
    />
  );
}
