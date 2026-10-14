-- Stable human references. UUID remains the actual identity and access key.
CREATE SEQUENCE public.thing_reference_number_seq START 1001;
ALTER TABLE public.things ADD COLUMN reference_number bigint DEFAULT nextval('public.thing_reference_number_seq') NOT NULL;
ALTER SEQUENCE public.thing_reference_number_seq OWNED BY public.things.reference_number;
ALTER TABLE public.things ADD CONSTRAINT things_reference_number_unique UNIQUE(reference_number);
ALTER TABLE public.things ADD CONSTRAINT things_reference_number_positive CHECK(reference_number > 0);
CREATE FUNCTION katalist_priv.keep_thing_reference_number()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.reference_number IS DISTINCT FROM OLD.reference_number THEN RAISE EXCEPTION 'Thing reference number is immutable'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION katalist_priv.keep_thing_reference_number() FROM PUBLIC;
CREATE TRIGGER keep_thing_reference_number BEFORE UPDATE OF reference_number ON public.things
 FOR EACH ROW EXECUTE FUNCTION katalist_priv.keep_thing_reference_number();
NOTIFY pgrst,'reload schema';
