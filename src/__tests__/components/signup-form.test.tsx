import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SignupForm } from "@/components/registro/signup-form"

/**
 * SignupForm — embudo post-alta según verification.required de /api/signup.
 *
 *  - required=false (sin RESEND_API_KEY → alta APPROVED): NO debe ir a
 *    /verificar; con auto-login exitoso va a /post-login y si el signIn
 *    falla muestra la pantalla de éxito con CTA a /login.
 *  - required=true (alta PENDING): va a /verificar con identifier/sent/
 *    required en la query. El auto-login también corre (PENDING sí puede
 *    iniciar sesión) para que /api/verify/start tenga sesión y el reenvío
 *    quede cubierto sin abrir un endpoint de enumeración.
 */

const { pushMock, refreshMock, signInMock } = vi.hoisted(() => ({
    pushMock: vi.fn(),
    refreshMock: vi.fn(),
    signInMock: vi.fn(),
}))

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}))

vi.mock("next-auth/react", () => ({
    signIn: signInMock,
}))

const jsonResponse = (body: unknown, status = 201) =>
    ({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
    }) as Response

const signupPayload = (required: boolean) => ({
    ok: true,
    slug: "taller-demo",
    verification: { emailSent: required, telegramUrl: null, required },
    urls: {
        home: "/taller-demo",
        market: "/taller-demo/market",
        orderStatus: "/taller-demo/order-status",
        admin: "/admin",
    },
})

function mockSignupFetch(body: unknown, status = 201) {
    const fn = vi.fn(() => Promise.resolve(jsonResponse(body, status)))
    vi.stubGlobal("fetch", fn)
    return fn
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/nombre del negocio/i), "Taller Demo")
    await user.type(screen.getByLabelText(/tu nombre/i), "Ana Dueña")
    await user.type(screen.getByLabelText(/correo electrónico/i), "ana@demo.com")
    await user.type(screen.getByLabelText(/^contraseña$/i), "password-segura")
    await user.click(screen.getByRole("button", { name: /crear mi negocio/i }))
}

describe("SignupForm", () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
        pushMock.mockReset()
        refreshMock.mockReset()
        signInMock.mockReset()
    })

    it("required=false + auto-login ok → va a /post-login, nunca a /verificar", async () => {
        mockSignupFetch(signupPayload(false))
        signInMock.mockResolvedValue({ error: null, ok: true })
        const user = userEvent.setup()
        render(<SignupForm signupEnabled />)

        await fillAndSubmit(user)

        await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/post-login"))
        expect(signInMock).toHaveBeenCalledWith("credentials", {
            identifier: "ana@demo.com",
            password: "password-segura",
            redirect: false,
        })
        expect(pushMock.mock.calls.some(([url]) => String(url).startsWith("/verificar"))).toBe(false)
        expect(screen.queryByRole("link", { name: /iniciar sesión/i })).not.toBeInTheDocument()
    })

    it("required=false + auto-login falla → pantalla de éxito con CTA a /login", async () => {
        mockSignupFetch(signupPayload(false))
        signInMock.mockResolvedValue({ error: "CredentialsSignin", ok: false })
        const user = userEvent.setup()
        render(<SignupForm signupEnabled />)

        await fillAndSubmit(user)

        await waitFor(() =>
            expect(screen.getByText(/tu negocio está listo/i)).toBeInTheDocument()
        )
        const loginCta = screen.getByRole("link", { name: /iniciar sesión/i })
        expect(loginCta).toHaveAttribute("href", "/login")
        expect(pushMock).not.toHaveBeenCalled()
    })

    it("required=true → va a /verificar con identifier, sent y required", async () => {
        mockSignupFetch(signupPayload(true))
        signInMock.mockResolvedValue({ error: null, ok: true })
        const user = userEvent.setup()
        render(<SignupForm signupEnabled />)

        await fillAndSubmit(user)

        await waitFor(() => expect(pushMock).toHaveBeenCalled())
        const url = String(pushMock.mock.calls[0][0])
        expect(url).toMatch(/^\/verificar\?/)
        const params = new URLSearchParams(url.split("?")[1])
        expect(params.get("identifier")).toBe("ana@demo.com")
        expect(params.get("sent")).toBe("1")
        expect(params.get("required")).toBe("1")
        // El auto-login corre también: con sesión /verificar puede reenviar.
        expect(signInMock).toHaveBeenCalled()
        expect(pushMock.mock.calls.some(([u]) => u === "/post-login")).toBe(false)
    })

    it("required=true + auto-login falla → igual va a /verificar (código sirve sin sesión)", async () => {
        mockSignupFetch(signupPayload(true))
        signInMock.mockRejectedValue(new Error("network"))
        const user = userEvent.setup()
        render(<SignupForm signupEnabled />)

        await fillAndSubmit(user)

        await waitFor(() => expect(pushMock).toHaveBeenCalled())
        expect(String(pushMock.mock.calls[0][0])).toMatch(/^\/verificar\?/)
    })
})
