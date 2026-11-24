// HTTP failures the route layer turns into a JSON body.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
