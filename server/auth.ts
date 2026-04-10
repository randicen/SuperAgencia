import { createClerkClient, verifyToken } from '@clerk/backend';
import type { NextFunction, Request, Response } from 'express';
import { HttpError } from './httpErrors.js';
import { getSupabaseAdmin } from './supabase.js';

export type AuthenticatedUser = {
  id: string;
  externalAuthId: string;
  email: string | null;
  user_metadata: {
    full_name?: string;
    name?: string;
    avatar_url?: string | null;
  };
};

export interface AuthenticatedRequest extends Request {
  authUser: AuthenticatedUser;
  accessToken: string;
}

let clerkClient: ReturnType<typeof createClerkClient> | null = null;

type ProfileIdentityRow = {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  clerk_user_id: string | null;
};

const getEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
};

const getClerkSecretKey = () => getEnv('CLERK_SECRET_KEY');

const getClerkClient = () => {
  if (!clerkClient) {
    clerkClient = createClerkClient({
      secretKey: getClerkSecretKey(),
    });
  }

  return clerkClient;
};

const getBearerToken = (req: Request): string => {
  const header = req.header('Authorization');
  if (!header) {
    throw new HttpError(401, 'missing_authorization', 'Debes iniciar sesión para usar Tandeba.');
  }

  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new HttpError(401, 'invalid_authorization', 'La sesión no es válida. Vuelve a iniciar sesión.');
  }

  return token;
};

const buildDisplayName = (user: Awaited<ReturnType<ReturnType<typeof createClerkClient>['users']['getUser']>>) => {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return {
    fullName: fullName || undefined,
    name: user.username ?? fullName ?? undefined,
  };
};

const resolveProfileIdentity = async (params: {
  clerkUserId: string;
  email: string | null;
  fullName?: string;
  avatarUrl?: string | null;
}): Promise<ProfileIdentityRow> => {
  const supabase = getSupabaseAdmin();
  const { clerkUserId, email, fullName, avatarUrl } = params;

  const byClerk = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url, clerk_user_id')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle();

  if (byClerk.error) {
    throw byClerk.error;
  }

  const patchProfile = async (profile: ProfileIdentityRow) => {
    const nextEmail = email ?? profile.email;
    const nextFullName = fullName ?? profile.full_name;
    const nextAvatarUrl = avatarUrl ?? profile.avatar_url;
    const needsUpdate =
      profile.clerk_user_id !== clerkUserId ||
      profile.email !== nextEmail ||
      profile.full_name !== nextFullName ||
      profile.avatar_url !== nextAvatarUrl;

    if (!needsUpdate) {
      return profile;
    }

    const updated = await supabase
      .from('profiles')
      .update({
        clerk_user_id: clerkUserId,
        email: nextEmail,
        full_name: nextFullName,
        avatar_url: nextAvatarUrl,
      })
      .eq('id', profile.id)
      .select('id, email, full_name, avatar_url, clerk_user_id')
      .single();

    if (updated.error || !updated.data) {
      throw updated.error ?? new Error('No fue posible enlazar el perfil existente con Clerk.');
    }

    return updated.data as ProfileIdentityRow;
  };

  if (byClerk.data) {
    return patchProfile(byClerk.data as ProfileIdentityRow);
  }

  if (email) {
    const byEmail = await supabase
      .from('profiles')
      .select('id, email, full_name, avatar_url, clerk_user_id')
      .eq('email', email)
      .maybeSingle();

    if (byEmail.error) {
      throw byEmail.error;
    }

    if (byEmail.data) {
      return patchProfile(byEmail.data as ProfileIdentityRow);
    }
  }

  if (!email) {
    throw new HttpError(
      400,
      'missing_email',
      'No fue posible identificar tu cuenta porque Clerk no devolvió un correo principal.',
    );
  }

  const inserted = await supabase
    .from('profiles')
    .insert({
      email,
      full_name: fullName ?? email.split('@')[0] ?? 'Tandeba User',
      avatar_url: avatarUrl ?? null,
      clerk_user_id: clerkUserId,
      timezone: 'America/Bogota',
      locale: 'es-CO',
      tier: 'free',
      account_status: 'active',
    })
    .select('id, email, full_name, avatar_url, clerk_user_id')
    .single();

  if (inserted.error || !inserted.data) {
    throw inserted.error ?? new Error('No fue posible crear el perfil del usuario.');
  }

  return inserted.data as ProfileIdentityRow;
};

const mapClerkUser = async (userId: string): Promise<AuthenticatedUser> => {
  const user = await getClerkClient().users.getUser(userId);
  const primaryEmail =
    user.emailAddresses.find((candidate) => candidate.id === user.primaryEmailAddressId) ??
    user.emailAddresses[0] ??
    null;
  const { fullName, name } = buildDisplayName(user);
  const profile = await resolveProfileIdentity({
    clerkUserId: user.id,
    email: primaryEmail?.emailAddress ?? null,
    fullName,
    avatarUrl: user.imageUrl ?? null,
  });

  return {
    id: profile.id,
    externalAuthId: user.id,
    email: profile.email,
    user_metadata: {
      full_name: profile.full_name || undefined,
      name: name,
      avatar_url: profile.avatar_url ?? null,
    },
  };
};

export const verifyAccessToken = async (accessToken: string): Promise<AuthenticatedUser> => {
  try {
    const claims = await verifyToken(accessToken, {
      secretKey: getClerkSecretKey(),
    });

    if (!claims.sub) {
      throw new HttpError(401, 'invalid_token', 'La sesión expiró o ya no es válida. Vuelve a iniciar sesión.');
    }

    return mapClerkUser(claims.sub);
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(401, 'invalid_token', 'La sesión expiró o ya no es válida. Vuelve a iniciar sesión.');
  }
};

export const requireAuth = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const accessToken = getBearerToken(req);
    const user = await verifyAccessToken(accessToken);
    const authedReq = req as AuthenticatedRequest;
    authedReq.authUser = user;
    authedReq.accessToken = accessToken;
    next();
  } catch (error) {
    next(error);
  }
};
