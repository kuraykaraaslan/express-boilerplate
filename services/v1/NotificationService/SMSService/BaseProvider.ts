export default abstract class BaseProvider {

    sendShortMessage(to: string, body: string): Promise<void> {
        // This method should be overridden by subclasses
        throw new Error('sendShortMessage method not implemented');
    }
}