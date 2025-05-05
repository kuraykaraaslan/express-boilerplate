// @ts-expect-error : That code works but typescript doesn't understand it
export {};

declare global {
  const AppError: {
    new (message: string, statusCode?: number): Error & {
      statusCode: number;
      isOperational: boolean;
    };
  };
}
