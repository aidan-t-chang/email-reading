export function promptOne(patterns, content, emails) {
    contents = [
            `Context:
            - This is a JavaScript application written in Electron
            - The application is a scheduling app that helps users manage their tasks and appointments.
            - Patterns are objects that the user makes to help organize tasks.
            Patterns:`,
            patterns,
            `Here are the other items that the user has scheduled:`,
            content,
            `Additionally, here are emails that the user has received: `,
            emails,
            `Your job:
            All outputs should be in a JSON format. The matching pattern, if available, should be "pattern:".
            The topic should be "topic:". The date should be "date:". The time should be "time:".
            Search the emails for both a date and time. If there is no date or no time, make the JSON value null.
            If you find both a date and time, look at the patterns and see if the event matches any of the patterns.
            For example, if there are tasks or patterns that use "HW" instead of "homework", and the email mentions "homework", use the "HW" instead.
            If possible, respond with the matching pattern, the date, and the time, in the JSON format.`
        ]
    return contents;
}