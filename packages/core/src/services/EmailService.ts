import { createTransport, Transporter } from 'nodemailer';

export interface EmailConfig {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
}

export interface SendEmailParams {
    to: string;
    subject: string;
    text: string;
    html?: string;
}

export class EmailService {
    private transporter: Transporter;
    private from: string;

    constructor(config: EmailConfig) {
        this.from = config.from;
        this.transporter = createTransport({
            host: config.host,
            port: config.port,
            secure: config.port === 465, // True for 465, false for other ports
            auth: {
                user: config.user,
                pass: config.pass,
            },
        });
    }

    async send(params: SendEmailParams): Promise<void> {
        await this.transporter.sendMail({
            from: this.from,
            to: params.to,
            subject: params.subject,
            text: params.text,
            html: params.html,
        });
    }
}
