import type { ErrorRequestHandler } from "express";
import multer from "multer";

export const errorMiddleware: ErrorRequestHandler = (
  error,
  _request,
  response,
  _next
) => {
  console.error(error);

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return response.status(400).json({
        message: "O arquivo não pode ultrapassar 50 MB."
      });
    }

    if (error.code === "LIMIT_FILE_COUNT") {
      return response.status(400).json({
        message: "Envie apenas um arquivo por vez."
      });
    }

    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      return response.status(400).json({
        message: "Campo de arquivo inesperado."
      });
    }

    return response.status(400).json({
      message: error.message
    });
  }

  if (error instanceof Error) {
    return response.status(400).json({
      message: error.message
    });
  }

  return response.status(500).json({
    message: "Erro interno do servidor."
  });
};