"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

interface QueryProviderProps {
  children: unknown;
}

export const QueryProvider = ({ children }: QueryProviderProps): JSX.Element => {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children as React.ComponentProps<typeof QueryClientProvider>["children"]}
    </QueryClientProvider>
  );
};
