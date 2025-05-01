// types/global.d.ts

export {};

declare global {
  var AppError: {
    new (message: string, statusCode?: number): Error & {
      statusCode: number;
      isOperational: boolean;
    };
  };
}
