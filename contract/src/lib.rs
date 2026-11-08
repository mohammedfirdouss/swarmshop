use near_sdk::store::IterableMap;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

const MIN_BUDGET: NearToken = NearToken::from_millinear(100);
const MAX_TITLE: usize = 120;
const MAX_DETAILS: usize = 4000;
const NS_PER_MINUTE: u64 = 60_000_000_000;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Bid {
    pub worker: AccountId,
    pub price: NearToken,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
#[serde(tag = "state")]
pub enum Status {
    Open,
    Paid {
        worker: AccountId,
        price: NearToken,
        patch_sha256: String,
    },
    Refunded,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Job {
    pub id: u64,
    pub customer: AccountId,
    pub title: String,
    pub details: String,
    pub budget: NearToken,
    pub deadline_ns: u64,
    pub bids: Vec<Bid>,
    pub status: Status,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default)]
pub struct Stats {
    pub jobs_posted: u64,
    pub jobs_paid: u64,
    pub jobs_refunded: u64,
    pub volume: NearToken,
    pub paid_to_workers: NearToken,
    pub margin: NearToken,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Shop {
    foreman: AccountId,
    jobs: IterableMap<u64, Job>,
    next_id: u64,
    stats: Stats,
}

fn is_direct_sub_account(account: &AccountId, parent: &AccountId) -> bool {
    account
        .as_str()
        .strip_suffix(parent.as_str())
        .and_then(|prefix| prefix.strip_suffix('.'))
        .is_some_and(|name| !name.is_empty() && !name.contains('.'))
}

#[near]
impl Shop {
    #[init]
    pub fn new(foreman: AccountId) -> Self {
        Self {
            foreman,
            jobs: IterableMap::new(b"j"),
            next_id: 0,
            stats: Stats::default(),
        }
    }

    #[payable]
    pub fn post_job(&mut self, title: String, details: String, minutes: u64) -> u64 {
        let budget = env::attached_deposit();
        require!(budget >= MIN_BUDGET, "budget must be at least 0.1 NEAR");
        require!(!title.is_empty() && title.len() <= MAX_TITLE, "title must be 1-120 bytes");
        require!(details.len() <= MAX_DETAILS, "details must be at most 4000 bytes");
        require!((1..=7 * 24 * 60).contains(&minutes), "minutes must be 1-10080");

        let id = self.next_id;
        self.next_id += 1;
        let job = Job {
            id,
            customer: env::predecessor_account_id(),
            title,
            details,
            budget,
            deadline_ns: env::block_timestamp() + minutes * NS_PER_MINUTE,
            bids: Vec::new(),
            status: Status::Open,
        };
        self.jobs.insert(id, job);
        self.stats.jobs_posted += 1;
        self.stats.volume = self.stats.volume.saturating_add(budget);
        env::log_str(&format!("job {id} posted with budget {budget}"));
        id
    }

    pub fn place_bid(&mut self, job_id: u64, price: NearToken) {
        let worker = env::predecessor_account_id();
        require!(
            is_direct_sub_account(&worker, &env::current_account_id()),
            "only worker sub-accounts of the shop can bid"
        );
        let job = self.open_job_mut(job_id);
        require!(env::block_timestamp() < job.deadline_ns, "job deadline has passed");
        require!(!price.is_zero() && price <= job.budget, "price must be above 0 and within the budget");
        match job.bids.iter_mut().find(|b| b.worker == worker) {
            Some(bid) => bid.price = price,
            None => job.bids.push(Bid { worker: worker.clone(), price }),
        }
        env::log_str(&format!("{worker} bid {price} on job {job_id}"));
    }

    pub fn award(&mut self, job_id: u64, worker: AccountId, patch_sha256: String) -> Promise {
        require!(env::predecessor_account_id() == self.foreman, "only the foreman can award");
        require!(
            patch_sha256.len() == 64 && patch_sha256.bytes().all(|b| b.is_ascii_hexdigit()),
            "patch_sha256 must be 64 hex characters"
        );
        let job = self.open_job_mut(job_id);
        let price = job
            .bids
            .iter()
            .find(|b| b.worker == worker)
            .map(|b| b.price)
            .unwrap_or_else(|| env::panic_str("worker did not bid on this job"));
        let margin = job.budget.saturating_sub(price);
        job.status = Status::Paid { worker: worker.clone(), price, patch_sha256 };

        self.stats.jobs_paid += 1;
        self.stats.paid_to_workers = self.stats.paid_to_workers.saturating_add(price);
        self.stats.margin = self.stats.margin.saturating_add(margin);
        env::log_str(&format!("job {job_id} paid {price} to {worker}, shop keeps {margin}"));
        Promise::new(worker).transfer(price)
    }

    pub fn refund(&mut self, job_id: u64) -> Promise {
        let caller = env::predecessor_account_id();
        let foreman = self.foreman.clone();
        let job = self.open_job_mut(job_id);
        let customer_after_deadline =
            caller == job.customer && env::block_timestamp() >= job.deadline_ns;
        require!(
            caller == foreman || customer_after_deadline,
            "only the foreman, or the customer after the deadline, can refund"
        );
        job.status = Status::Refunded;
        let (customer, budget) = (job.customer.clone(), job.budget);

        self.stats.jobs_refunded += 1;
        env::log_str(&format!("job {job_id} refunded {budget} to {customer}"));
        Promise::new(customer).transfer(budget)
    }

    pub fn get_job(&self, job_id: u64) -> Option<Job> {
        self.jobs.get(&job_id).cloned()
    }

    pub fn list_jobs(&self, from: Option<u64>, limit: Option<u64>) -> Vec<Job> {
        let from = from.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100);
        (from..self.next_id.min(from.saturating_add(limit)))
            .filter_map(|id| self.jobs.get(&id).cloned())
            .collect()
    }

    pub fn stats(&self) -> Stats {
        self.stats.clone()
    }

    pub fn foreman(&self) -> AccountId {
        self.foreman.clone()
    }
}

impl Shop {
    fn open_job_mut(&mut self, job_id: u64) -> &mut Job {
        let job = self
            .jobs
            .get_mut(&job_id)
            .unwrap_or_else(|| env::panic_str("no such job"));
        require!(job.status == Status::Open, "job is already finished");
        job
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    const SHA: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn as_caller(who: &str, deposit: NearToken, now_ns: u64) {
        testing_env!(VMContextBuilder::new()
            .current_account_id(acc("shop.testnet"))
            .predecessor_account_id(acc(who))
            .attached_deposit(deposit)
            .block_timestamp(now_ns)
            .build());
    }

    fn shop_with_job() -> Shop {
        as_caller("shop.testnet", NearToken::from_near(0), 0);
        let mut shop = Shop::new(acc("foreman.shop.testnet"));
        as_caller("alice.testnet", NearToken::from_near(1), 0);
        shop.post_job("Fix slugify".into(), "it drops digits".into(), 30);
        shop
    }

    fn bid(shop: &mut Shop, worker: &str, millinear: u128) {
        as_caller(worker, NearToken::from_near(0), 1);
        shop.place_bid(0, NearToken::from_millinear(millinear));
    }

    #[test]
    fn award_pays_the_bid_and_keeps_the_margin() {
        let mut shop = shop_with_job();
        bid(&mut shop, "worker-a.shop.testnet", 600);
        bid(&mut shop, "worker-b.shop.testnet", 400);

        as_caller("foreman.shop.testnet", NearToken::from_near(0), 2);
        shop.award(0, acc("worker-b.shop.testnet"), SHA.into());

        let job = shop.get_job(0).unwrap();
        assert_eq!(
            job.status,
            Status::Paid {
                worker: acc("worker-b.shop.testnet"),
                price: NearToken::from_millinear(400),
                patch_sha256: SHA.into()
            }
        );
        let stats = shop.stats();
        assert_eq!(stats.jobs_paid, 1);
        assert_eq!(stats.paid_to_workers, NearToken::from_millinear(400));
        assert_eq!(stats.margin, NearToken::from_millinear(600));
        assert!(get_logs().iter().any(|l| l.contains("shop keeps")));
    }

    #[test]
    fn rebid_replaces_the_old_price() {
        let mut shop = shop_with_job();
        bid(&mut shop, "worker-a.shop.testnet", 600);
        bid(&mut shop, "worker-a.shop.testnet", 300);
        let bids = shop.get_job(0).unwrap().bids;
        assert_eq!(bids.len(), 1);
        assert_eq!(bids[0].price, NearToken::from_millinear(300));
    }

    #[test]
    #[should_panic(expected = "only worker sub-accounts of the shop can bid")]
    fn outsiders_cannot_bid() {
        let mut shop = shop_with_job();
        bid(&mut shop, "mallory.testnet", 100);
    }

    #[test]
    #[should_panic(expected = "only worker sub-accounts of the shop can bid")]
    fn nested_sub_accounts_cannot_bid() {
        let mut shop = shop_with_job();
        bid(&mut shop, "x.worker-a.shop.testnet", 100);
    }

    #[test]
    #[should_panic(expected = "price must be above 0 and within the budget")]
    fn bids_over_budget_are_rejected() {
        let mut shop = shop_with_job();
        bid(&mut shop, "worker-a.shop.testnet", 1001);
    }

    #[test]
    #[should_panic(expected = "only the foreman can award")]
    fn workers_cannot_award_themselves() {
        let mut shop = shop_with_job();
        bid(&mut shop, "worker-a.shop.testnet", 500);
        as_caller("worker-a.shop.testnet", NearToken::from_near(0), 2);
        shop.award(0, acc("worker-a.shop.testnet"), SHA.into());
    }

    #[test]
    #[should_panic(expected = "worker did not bid on this job")]
    fn award_requires_a_bid() {
        let mut shop = shop_with_job();
        as_caller("foreman.shop.testnet", NearToken::from_near(0), 2);
        shop.award(0, acc("worker-a.shop.testnet"), SHA.into());
    }

    #[test]
    #[should_panic(expected = "job is already finished")]
    fn a_paid_job_cannot_be_refunded() {
        let mut shop = shop_with_job();
        bid(&mut shop, "worker-a.shop.testnet", 500);
        as_caller("foreman.shop.testnet", NearToken::from_near(0), 2);
        shop.award(0, acc("worker-a.shop.testnet"), SHA.into());
        shop.refund(0);
    }

    #[test]
    #[should_panic(expected = "only the foreman, or the customer after the deadline, can refund")]
    fn customer_cannot_refund_before_the_deadline() {
        let mut shop = shop_with_job();
        as_caller("alice.testnet", NearToken::from_near(0), 1);
        shop.refund(0);
    }

    #[test]
    fn customer_can_refund_after_the_deadline() {
        let mut shop = shop_with_job();
        as_caller("alice.testnet", NearToken::from_near(0), 31 * NS_PER_MINUTE);
        shop.refund(0);
        assert_eq!(shop.get_job(0).unwrap().status, Status::Refunded);
        assert_eq!(shop.stats().jobs_refunded, 1);
    }

    #[test]
    #[should_panic(expected = "job deadline has passed")]
    fn late_bids_are_rejected() {
        let mut shop = shop_with_job();
        as_caller("worker-a.shop.testnet", NearToken::from_near(0), 31 * NS_PER_MINUTE);
        shop.place_bid(0, NearToken::from_millinear(100));
    }

    #[test]
    #[should_panic(expected = "budget must be at least 0.1 NEAR")]
    fn tiny_budgets_are_rejected() {
        let mut shop = shop_with_job();
        as_caller("alice.testnet", NearToken::from_millinear(10), 0);
        shop.post_job("t".into(), "d".into(), 30);
    }
}
