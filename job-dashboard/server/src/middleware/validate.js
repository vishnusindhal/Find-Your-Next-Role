export function validateQuery(schema) {
  return (request, response, next) => {
    const result = schema.safeParse(request.query);
    if (!result.success) {
      return response.status(400).json({
        error: "Invalid query parameters",
        details: result.error.flatten(),
      });
    }
    request.validatedQuery = result.data;
    return next();
  };
}

export function validateBody(schema) {
  return (request, response, next) => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      return response.status(400).json({
        error: "Invalid request body",
        details: result.error.flatten(),
      });
    }
    request.validatedBody = result.data;
    return next();
  };
}
